import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  runFullAnalysis,
  checkVolatility,
  buildVolatilityReport,
  startScheduler,
  stopScheduler,
  registerSSEClient,
  unregisterSSEClient,
  getPostCloseTaskList,
  executePostCloseTask,
  PostCloseTask,
} from './schedulerService';
import * as analysisService from '../analysis/analysisService';
import * as marketDataService from '../market/marketDataService';
import { clearSnapshotCache } from './changeDetector';
import * as tradingDayGuard from './tradingDayGuard';

jest.mock('../analysis/analysisService');
jest.mock('../market/marketDataService');
jest.mock('../indicators/indicatorService', () => ({
  getIndicators: jest.fn().mockReturnValue({
    stockCode: '600000', tradeDate: '2025-01-01',
    ma: { ma5: 10, ma10: 10, ma20: 10, ma60: 10 },
    macd: { dif: 0.1, dea: 0.05, histogram: 0.05 },
    kdj: { k: 50, d: 50, j: 50 },
    rsi: { rsi6: 50, rsi12: 50, rsi24: 50 },
    signals: { ma: 'n', macd: 'n', kdj: 'n', rsi: 'n' },
    updatedAt: '2025-01-01',
  }),
}));

const mockTrigger = analysisService.triggerAnalysis as jest.MockedFunction<typeof analysisService.triggerAnalysis>;
const mockQuote = marketDataService.getQuote as jest.MockedFunction<typeof marketDataService.getQuote>;

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function addUser(db: Database.Database, id: number) {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, 'u' + id, 'h');
}

function addPos(db: Database.Database, uid: number, code: string, name: string) {
  db.prepare(
    'INSERT INTO positions (user_id, stock_code, stock_name, cost_price, shares, buy_date) VALUES (?, ?, ?, 10, 100, ?)'
  ).run(uid, code, name, '2025-01-01');
}

const mockResult: any = {
  id: 1, stockCode: '600000', stockName: 'test', triggerType: 'scheduled',
  stage: 'rising', spaceEstimate: '10%', keySignals: ['MACD'], actionRef: 'hold',
  batchPlan: null, confidence: 75, reasoning: 'ok', dataSources: null,
  technicalIndicators: null, newsSummary: null, recoveryEstimate: null,
  profitEstimate: null, riskAlerts: null, createdAt: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  clearSnapshotCache();
  mockTrigger.mockResolvedValue(mockResult);
  mockQuote.mockResolvedValue({
    stockCode: '600000', stockName: 'test', price: 11.5,
    changePercent: 2.5, volume: 100000, timestamp: new Date().toISOString(),
  });
});

afterEach(() => { stopScheduler(); });

describe('runFullAnalysis', () => {
  it('should analyze deduplicated stocks', async () => {
    const db = makeDb();
    addUser(db, 1); addUser(db, 2);
    addPos(db, 1, '600000', 'A'); addPos(db, 2, '000001', 'B');
    const count = await runFullAnalysis(db);
    expect(count).toBe(2);
    expect(mockTrigger).toHaveBeenCalledTimes(2);
  });

  it('should distribute messages to holders', async () => {
    const db = makeDb();
    addUser(db, 1); addPos(db, 1, '600000', 'A');
    await runFullAnalysis(db);
    const msgs = db.prepare("SELECT * FROM messages WHERE type = 'scheduled_analysis'").all() as any[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].stock_code).toBe('600000');
  });

  it('should return 0 when no positions', async () => {
    const db = makeDb();
    const count = await runFullAnalysis(db);
    expect(count).toBe(0);
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it('should continue on individual stock failure', async () => {
    const db = makeDb();
    addUser(db, 1);
    addPos(db, 1, '600000', 'A'); addPos(db, 1, '000001', 'B');
    mockTrigger.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(mockResult);
    const count = await runFullAnalysis(db);
    expect(count).toBe(1);
  });

  it('should push SSE notification to holders', async () => {
    const db = makeDb();
    addUser(db, 1); addPos(db, 1, '600000', 'A');
    const mockWrite = jest.fn();
    const mockRes = { write: mockWrite };
    registerSSEClient(1, mockRes);
    await runFullAnalysis(db);
    expect(mockWrite).toHaveBeenCalled();
    const written = mockWrite.mock.calls[0][0] as string;
    expect(written).toContain('event: analysis');
    unregisterSSEClient(mockRes);
  });

  it('should skip unchanged stocks via change detection', async () => {
    const db = makeDb();
    addUser(db, 1); addPos(db, 1, '600000', 'A');
    await runFullAnalysis(db);
    expect(mockTrigger).toHaveBeenCalledTimes(1);
    mockTrigger.mockClear();
    const count = await runFullAnalysis(db);
    expect(count).toBe(0);
    expect(mockTrigger).not.toHaveBeenCalled();
  });
});

describe('checkVolatility', () => {
  it('should trigger for >3% change', async () => {
    const db = makeDb();
    addUser(db, 1); addPos(db, 1, '600000', 'A');
    await checkVolatility('600000', 3.5, db);
    expect(mockTrigger).toHaveBeenCalledWith('600000', 1, 'volatility', db);
  });

  it('should trigger high volatility for >5%', async () => {
    const db = makeDb();
    addUser(db, 1); addPos(db, 1, '600000', 'A');
    await checkVolatility('600000', -6.2, db);
    expect(mockTrigger).toHaveBeenCalled();
    const msgs = db.prepare("SELECT * FROM messages WHERE type = 'volatility_alert'").all() as any[];
    expect(msgs).toHaveLength(1);
  });

  it('should not trigger for <=3%', async () => {
    const db = makeDb();
    addUser(db, 1); addPos(db, 1, '600000', 'A');
    await checkVolatility('600000', 2.5, db);
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it('should store volatility_alert message', async () => {
    const db = makeDb();
    addUser(db, 1); addPos(db, 1, '600000', 'A');
    await checkVolatility('600000', 4.0, db);
    const msgs = db.prepare("SELECT * FROM messages WHERE type = 'volatility_alert'").all() as any[];
    expect(msgs).toHaveLength(1);
  });
});

describe('buildVolatilityReport', () => {
  it('should return >=2 data support items', async () => {
    const db = makeDb();
    const report = await buildVolatilityReport('600000', 5.5, db);
    expect(report.stockCode).toBe('600000');
    expect(report.dataSupport.length).toBeGreaterThanOrEqual(2);
  });

  it('should indicate direction in reason', async () => {
    const db = makeDb();
    const up = await buildVolatilityReport('600000', 5.5, db);
    expect(up.reason).toContain('大幅上涨');
    const down = await buildVolatilityReport('600000', -7.0, db);
    expect(down.reason).toContain('大幅下跌');
  });
});

describe('startScheduler / stopScheduler', () => {
  it('should start and stop without error', () => {
    expect(() => startScheduler()).not.toThrow();
    expect(() => stopScheduler()).not.toThrow();
  });
  it('should be idempotent', () => {
    startScheduler(); startScheduler(); stopScheduler();
  });
});

describe('SSE client registry', () => {
  it('should register and unregister', () => {
    const r = { write: jest.fn() };
    registerSSEClient(1, r);
    unregisterSSEClient(r);
  });
});

describe('getPostCloseTaskList', () => {
  it('should return 11 tasks in correct order', () => {
    const tasks = getPostCloseTaskList();
    expect(tasks).toHaveLength(11);
    expect(tasks[0].name).toBe('K线增量更新');
    expect(tasks[0].hour).toBe(15);
    expect(tasks[0].minute).toBe(30);
    expect(tasks[10].name).toBe('操作复盘评价生成');
    expect(tasks[10].hour).toBe(17);
    expect(tasks[10].minute).toBe(20);
  });

  it('should have staggered times from 15:30 to 17:20', () => {
    const tasks = getPostCloseTaskList();
    for (let i = 1; i < tasks.length; i++) {
      const prevMinutes = tasks[i - 1].hour * 60 + tasks[i - 1].minute;
      const currMinutes = tasks[i].hour * 60 + tasks[i].minute;
      expect(currMinutes).toBeGreaterThan(prevMinutes);
    }
  });

  it('should include all expected task names', () => {
    const tasks = getPostCloseTaskList();
    const names = tasks.map(t => t.name);
    expect(names).toContain('K线增量更新');
    expect(names).toContain('估值分位数据更新');
    expect(names).toContain('板块轮动阶段判断');
    expect(names).toContain('商品传导链状态更新');
    expect(names).toContain('大盘环境判断');
    expect(names).toContain('市场情绪指数计算');
    expect(names).toContain('周期底部检测');
    expect(names).toContain('每日关注追踪');
    expect(names).toContain('持仓集中度检查');
    expect(names).toContain('持仓快照记录');
    expect(names).toContain('操作复盘评价生成');
  });
});

describe('executePostCloseTask', () => {
  it('should skip on non-trading day', async () => {
    const spy = jest.spyOn(tradingDayGuard, 'isTradingDay').mockReturnValue(false);
    const executeFn = jest.fn().mockResolvedValue(undefined);
    const task: PostCloseTask = { hour: 16, minute: 0, name: 'test', execute: executeFn };
    const db = makeDb();
    await executePostCloseTask(task, db);
    expect(executeFn).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should execute task on trading day', async () => {
    const spy = jest.spyOn(tradingDayGuard, 'isTradingDay').mockReturnValue(true);
    const executeFn = jest.fn().mockResolvedValue(undefined);
    const task: PostCloseTask = { hour: 16, minute: 0, name: 'test', execute: executeFn };
    const db = makeDb();
    await executePostCloseTask(task, db);
    expect(executeFn).toHaveBeenCalledWith(db);
    spy.mockRestore();
  });

  it('should catch task failure without throwing', async () => {
    const spy = jest.spyOn(tradingDayGuard, 'isTradingDay').mockReturnValue(true);
    const executeFn = jest.fn().mockRejectedValue(new Error('boom'));
    const task: PostCloseTask = { hour: 16, minute: 0, name: 'failTask', execute: executeFn };
    const db = makeDb();
    await expect(executePostCloseTask(task, db)).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
