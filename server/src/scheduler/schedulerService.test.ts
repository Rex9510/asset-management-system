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
} from './schedulerService';
import * as analysisService from '../analysis/analysisService';
import * as marketDataService from '../market/marketDataService';

jest.mock('../analysis/analysisService');
jest.mock('../market/marketDataService');

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
  mockTrigger.mockResolvedValue(mockResult);
  mockQuote.mockResolvedValue({
    stockCode: '600000', stockName: 'test', price: 11.5,
    changePercent: 2.5, volume: 100000, timestamp: new Date().toISOString(),
  });
});

afterEach(() => { stopScheduler(); });

describe('runFullAnalysis', () => {
  it('should analyze all user positions', async () => {
    const db = makeDb();
    addUser(db, 1); addUser(db, 2);
    addPos(db, 1, '600000', 'A'); addPos(db, 2, '000001', 'B');
    const count = await runFullAnalysis(db);
    expect(count).toBe(2);
    expect(mockTrigger).toHaveBeenCalledTimes(2);
  });

  it('should store messages in messages table', async () => {
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

  it('should continue on individual failure', async () => {
    const db = makeDb();
    addUser(db, 1);
    addPos(db, 1, '600000', 'A'); addPos(db, 1, '000001', 'B');
    mockTrigger.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(mockResult);
    const count = await runFullAnalysis(db);
    expect(count).toBe(1);
  });

  it('should push SSE notification', async () => {
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
    expect(up.reason).toMatch(/上涨/);
    const down = await buildVolatilityReport('600000', -7.0, db);
    expect(down.reason).toMatch(/下跌/);
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