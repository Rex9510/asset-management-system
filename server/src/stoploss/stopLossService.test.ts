import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  setStopLoss,
  checkStopLossAlerts,
  checkAndNotifyStopLoss,
  getAIStopLossEvaluation,
  StopLossAlert,
} from './stopLossService';

let testDb: Database.Database;
let mockChat: jest.Mock;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

jest.mock('../ai/aiProviderFactory', () => ({
  getAIProvider: () => ({
    chat: (...args: unknown[]) => mockChat(...args),
    getModelName: () => 'test-model',
  }),
}));

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function insertUser(db: Database.Database, userId: number): void {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(userId, `user${userId}`, 'hash');
}

function insertPosition(
  db: Database.Database,
  userId: number,
  stockCode: string,
  stockName: string,
  opts: { costPrice?: number; shares?: number; buyDate?: string; stopLossPrice?: number | null } = {}
): number {
  const result = db.prepare(
    `INSERT INTO positions (user_id, stock_code, stock_name, position_type, cost_price, shares, buy_date, stop_loss_price)
     VALUES (?, ?, ?, 'holding', ?, ?, ?, ?)`
  ).run(
    userId, stockCode, stockName,
    opts.costPrice ?? 10.0,
    opts.shares ?? 100,
    opts.buyDate ?? '2024-01-01',
    opts.stopLossPrice ?? null
  );
  return result.lastInsertRowid as number;
}

function insertMarketCache(db: Database.Database, stockCode: string, price: number, stockName?: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at)
     VALUES (?, ?, ?, 0, 1000000, datetime('now'))`
  ).run(stockCode, stockName ?? stockCode, price);
}

function getMessages(db: Database.Database, userId: number): Array<{ type: string; stock_code: string; summary: string; detail: string }> {
  return db.prepare(
    'SELECT type, stock_code, summary, detail FROM messages WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId) as Array<{ type: string; stock_code: string; summary: string; detail: string }>;
}

beforeEach(() => {
  testDb = makeDb();
  mockChat = jest.fn();
});

afterEach(() => {
  testDb.close();
});

// --- setStopLoss ---

describe('setStopLoss', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
  });

  it('should set stop loss price and return updated position', () => {
    const posId = insertPosition(testDb, 1, '600000', '浦发银行');
    const result = setStopLoss(posId, 1, 8.5, testDb) as Record<string, unknown>;

    expect(result.stop_loss_price).toBe(8.5);
    expect(result.id).toBe(posId);
  });

  it('should reject non-positive stop loss price', () => {
    const posId = insertPosition(testDb, 1, '600000', '浦发银行');

    expect(() => setStopLoss(posId, 1, 0, testDb)).toThrow('止损价必须为正数');
    expect(() => setStopLoss(posId, 1, -5, testDb)).toThrow('止损价必须为正数');
  });

  it('should reject NaN and Infinity', () => {
    const posId = insertPosition(testDb, 1, '600000', '浦发银行');

    expect(() => setStopLoss(posId, 1, NaN, testDb)).toThrow('止损价必须为正数');
    expect(() => setStopLoss(posId, 1, Infinity, testDb)).toThrow('止损价必须为正数');
  });

  it('should throw when position not found', () => {
    expect(() => setStopLoss(999, 1, 8.5, testDb)).toThrow('持仓记录不存在');
  });

  it('should throw when position belongs to different user', () => {
    insertUser(testDb, 2);
    const posId = insertPosition(testDb, 1, '600000', '浦发银行');

    expect(() => setStopLoss(posId, 2, 8.5, testDb)).toThrow('持仓记录不存在');
  });

  it('should update existing stop loss price', () => {
    const posId = insertPosition(testDb, 1, '600000', '浦发银行', { stopLossPrice: 7.0 });
    const result = setStopLoss(posId, 1, 8.5, testDb) as Record<string, unknown>;

    expect(result.stop_loss_price).toBe(8.5);
  });
});

// --- checkStopLossAlerts ---

describe('checkStopLossAlerts', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
  });

  it('should detect triggered alerts when current price <= stop loss price', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', { stopLossPrice: 9.0 });
    insertMarketCache(testDb, '600000', 8.5);

    const alerts = checkStopLossAlerts(1, testDb);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].triggered).toBe(true);
    expect(alerts[0].stockCode).toBe('600000');
    expect(alerts[0].currentPrice).toBe(8.5);
    expect(alerts[0].stopLossPrice).toBe(9.0);
  });

  it('should mark as triggered when price equals stop loss price', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', { stopLossPrice: 9.0 });
    insertMarketCache(testDb, '600000', 9.0);

    const alerts = checkStopLossAlerts(1, testDb);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].triggered).toBe(true);
  });

  it('should not trigger when current price > stop loss price', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', { stopLossPrice: 9.0 });
    insertMarketCache(testDb, '600000', 10.0);

    const alerts = checkStopLossAlerts(1, testDb);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].triggered).toBe(false);
  });

  it('should skip positions without stop loss price', () => {
    insertPosition(testDb, 1, '600000', '浦发银行');
    insertMarketCache(testDb, '600000', 8.5);

    const alerts = checkStopLossAlerts(1, testDb);
    expect(alerts).toHaveLength(0);
  });

  it('should skip positions without market cache data', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', { stopLossPrice: 9.0 });
    // No market cache inserted

    const alerts = checkStopLossAlerts(1, testDb);
    expect(alerts).toHaveLength(0);
  });

  it('should return empty array when user has no positions', () => {
    const alerts = checkStopLossAlerts(1, testDb);
    expect(alerts).toHaveLength(0);
  });

  it('should handle multiple positions', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', { stopLossPrice: 9.0 });
    insertPosition(testDb, 1, '600036', '招商银行', { stopLossPrice: 30.0 });
    insertMarketCache(testDb, '600000', 8.5);
    insertMarketCache(testDb, '600036', 35.0);

    const alerts = checkStopLossAlerts(1, testDb);

    expect(alerts).toHaveLength(2);
    const triggered = alerts.filter(a => a.triggered);
    const notTriggered = alerts.filter(a => !a.triggered);
    expect(triggered).toHaveLength(1);
    expect(triggered[0].stockCode).toBe('600000');
    expect(notTriggered).toHaveLength(1);
    expect(notTriggered[0].stockCode).toBe('600036');
  });
});


// --- checkAndNotifyStopLoss ---

describe('checkAndNotifyStopLoss', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
    insertUser(testDb, 2);
  });

  it('should create stop_loss_alert message when triggered', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', { stopLossPrice: 9.0 });
    insertMarketCache(testDb, '600000', 8.5);

    checkAndNotifyStopLoss(testDb);

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('stop_loss_alert');
    expect(msgs[0].summary).toBe('⚠️ 浦发银行 已触发止损线');

    const detail = JSON.parse(msgs[0].detail);
    expect(detail.stockCode).toBe('600000');
    expect(detail.stopLossPrice).toBe(9.0);
    expect(detail.currentPrice).toBe(8.5);
    expect(detail.positionId).toBeDefined();
    expect(detail.triggerTime).toBeDefined();
  });

  it('should not create message when price > stop loss price', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', { stopLossPrice: 9.0 });
    insertMarketCache(testDb, '600000', 10.0);

    checkAndNotifyStopLoss(testDb);

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(0);
  });

  it('should not duplicate message within 24 hours', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', { stopLossPrice: 9.0 });
    insertMarketCache(testDb, '600000', 8.5);

    checkAndNotifyStopLoss(testDb);
    checkAndNotifyStopLoss(testDb);

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(1);
  });

  it('should handle multiple users independently', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', { stopLossPrice: 9.0 });
    insertPosition(testDb, 2, '600000', '浦发银行', { stopLossPrice: 9.0 });
    insertMarketCache(testDb, '600000', 8.5);

    checkAndNotifyStopLoss(testDb);

    const msgs1 = getMessages(testDb, 1);
    const msgs2 = getMessages(testDb, 2);
    expect(msgs1).toHaveLength(1);
    expect(msgs2).toHaveLength(1);
  });

  it('should skip positions without market cache', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', { stopLossPrice: 9.0 });
    // No market cache

    checkAndNotifyStopLoss(testDb);

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(0);
  });

  it('should skip positions without stop loss price', () => {
    insertPosition(testDb, 1, '600000', '浦发银行');
    insertMarketCache(testDb, '600000', 8.5);

    checkAndNotifyStopLoss(testDb);

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(0);
  });
});

// --- getAIStopLossEvaluation ---

describe('getAIStopLossEvaluation', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
  });

  it('should call AI with correct context and return result', async () => {
    insertPosition(testDb, 1, '600000', '浦发银行', {
      costPrice: 12.0, shares: 100, buyDate: '2024-01-01', stopLossPrice: 10.0,
    });
    insertMarketCache(testDb, '600000', 9.5, '浦发银行');

    mockChat.mockResolvedValue('这是AI止损评估参考方案');

    const result = await getAIStopLossEvaluation('600000', 1, testDb);

    expect(result).toBe('这是AI止损评估参考方案');
    expect(mockChat).toHaveBeenCalledTimes(1);

    // Verify system prompt instructs AI to use "参考方案" wording
    const [messages, systemPrompt] = mockChat.mock.calls[0];
    expect(systemPrompt).toContain('参考方案');
    // The prompt instructs AI to use "参考方案" and forbids "建议"/"推荐" in output
    expect(systemPrompt).toContain('禁止');

    // Verify user message contains position context
    expect(messages[0].content).toContain('600000');
    expect(messages[0].content).toContain('浦发银行');
    expect(messages[0].content).toContain('9.5');
    expect(messages[0].content).toContain('12');
  });

  it('should ask AI for reference stop loss price when none set', async () => {
    insertPosition(testDb, 1, '600000', '浦发银行', {
      costPrice: 12.0, shares: 100, buyDate: '2024-01-01',
    });
    insertMarketCache(testDb, '600000', 9.5, '浦发银行');

    mockChat.mockResolvedValue('参考止损价：8.0元');

    const result = await getAIStopLossEvaluation('600000', 1, testDb);

    expect(result).toBe('参考止损价：8.0元');

    const [messages] = mockChat.mock.calls[0];
    expect(messages[0].content).toContain('参考止损价');
  });

  it('should work even without position data', async () => {
    insertMarketCache(testDb, '600000', 9.5, '浦发银行');
    mockChat.mockResolvedValue('AI评估结果');

    const result = await getAIStopLossEvaluation('600000', 1, testDb);
    expect(result).toBe('AI评估结果');
    expect(mockChat).toHaveBeenCalledTimes(1);
  });
});
