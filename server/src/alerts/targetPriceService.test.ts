import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  checkTargetPrice,
  extractTargetPrice,
  runTargetPriceCheck,
  TargetPriceAlertResult,
} from './targetPriceService';

let testDb: Database.Database;
let mockGetQuote: jest.Mock;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

jest.mock('../market/marketDataService', () => ({
  getQuote: (...args: unknown[]) => mockGetQuote(...args),
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

function insertPosition(db: Database.Database, userId: number, stockCode: string, stockName: string): void {
  db.prepare(
    `INSERT INTO positions (user_id, stock_code, stock_name, cost_price, shares, buy_date)
     VALUES (?, ?, ?, 10.0, 100, '2024-01-01')`
  ).run(userId, stockCode, stockName);
}

function insertAnalysis(
  db: Database.Database,
  userId: number,
  stockCode: string,
  stockName: string,
  profitEstimate: string | null,
  spaceEstimate: string | null
): number {
  const result = db.prepare(
    `INSERT INTO analyses (user_id, stock_code, stock_name, trigger_type, stage, action_ref, confidence, reasoning, profit_estimate, space_estimate)
     VALUES (?, ?, ?, 'scheduled', 'rising', 'hold', 80, 'test reasoning', ?, ?)`
  ).run(userId, stockCode, stockName, profitEstimate, spaceEstimate);
  return result.lastInsertRowid as number;
}

function getMessages(db: Database.Database, userId: number): Array<{ type: string; stock_code: string; summary: string; detail: string }> {
  return db.prepare(
    `SELECT type, stock_code, summary, detail FROM messages WHERE user_id = ? ORDER BY created_at DESC`
  ).all(userId) as Array<{ type: string; stock_code: string; summary: string; detail: string }>;
}

beforeEach(() => {
  testDb = makeDb();
  mockGetQuote = jest.fn();
});

afterEach(() => {
  testDb.close();
});

// --- extractTargetPrice ---

describe('extractTargetPrice', () => {
  it('should extract target price from profit_estimate JSON with targetPrice field', () => {
    const result = extractTargetPrice({
      id: 1,
      profit_estimate: JSON.stringify({ targetPrice: 15.5 }),
      space_estimate: null,
    });
    expect(result).toBe(15.5);
  });

  it('should extract target price from profit_estimate JSON with targetPriceHigh field', () => {
    const result = extractTargetPrice({
      id: 1,
      profit_estimate: JSON.stringify({ targetPriceHigh: 20.0 }),
      space_estimate: null,
    });
    expect(result).toBe(20.0);
  });

  it('should extract target price from space_estimate when profit_estimate has none', () => {
    const result = extractTargetPrice({
      id: 1,
      profit_estimate: null,
      space_estimate: JSON.stringify({ targetPrice: 18.0 }),
    });
    expect(result).toBe(18.0);
  });

  it('should extract target price from plain text with "目标价" pattern', () => {
    const result = extractTargetPrice({
      id: 1,
      profit_estimate: '预计目标价15.5元',
      space_estimate: null,
    });
    expect(result).toBe(15.5);
  });

  it('should return null when no target price found', () => {
    const result = extractTargetPrice({
      id: 1,
      profit_estimate: null,
      space_estimate: null,
    });
    expect(result).toBeNull();
  });

  it('should return null for invalid JSON without recognizable fields', () => {
    const result = extractTargetPrice({
      id: 1,
      profit_estimate: JSON.stringify({ foo: 'bar' }),
      space_estimate: JSON.stringify({ baz: 'qux' }),
    });
    expect(result).toBeNull();
  });
});

// --- checkTargetPrice ---

describe('checkTargetPrice', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
  });

  it('should send "到达目标价" alert when price >= target price', async () => {
    mockGetQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 15.5,
      changePercent: 2.0,
      volume: 1000000,
      timestamp: '2024-01-10T10:00:00Z',
    });

    const result = await checkTargetPrice('600000', 1, 15.0, testDb);

    expect(result).not.toBeNull();
    expect(result!.alertType).toBe('reached');
    expect(result!.message).toBe('到达目标价，可考虑分批出货');

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('target_price_alert');
    expect(msgs[0].summary).toContain('到达目标价');
  });

  it('should send "接近目标价" alert when price >= 90% of target but < target', async () => {
    mockGetQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 13.5,
      changePercent: 1.5,
      volume: 1000000,
      timestamp: '2024-01-10T10:00:00Z',
    });

    const result = await checkTargetPrice('600000', 1, 15.0, testDb);

    expect(result).not.toBeNull();
    expect(result!.alertType).toBe('approaching');
    expect(result!.message).toBe('接近目标价');

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('target_price_alert');
    expect(msgs[0].summary).toContain('接近目标价');
  });

  it('should not send alert when price < 90% of target', async () => {
    mockGetQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 10.0,
      changePercent: 0.5,
      volume: 1000000,
      timestamp: '2024-01-10T10:00:00Z',
    });

    const result = await checkTargetPrice('600000', 1, 15.0, testDb);

    expect(result).toBeNull();
    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(0);
  });

  it('should not send duplicate alert within 24 hours', async () => {
    mockGetQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 15.5,
      changePercent: 2.0,
      volume: 1000000,
      timestamp: '2024-01-10T10:00:00Z',
    });

    // First call should create alert
    const result1 = await checkTargetPrice('600000', 1, 15.0, testDb);
    expect(result1).not.toBeNull();

    // Second call should be suppressed
    const result2 = await checkTargetPrice('600000', 1, 15.0, testDb);
    expect(result2).toBeNull();

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(1);
  });

  it('should return null for invalid target price (0 or negative)', async () => {
    const result = await checkTargetPrice('600000', 1, 0, testDb);
    expect(result).toBeNull();

    const result2 = await checkTargetPrice('600000', 1, -5, testDb);
    expect(result2).toBeNull();
  });

  it('should return null when getQuote fails', async () => {
    mockGetQuote.mockRejectedValue(new Error('Network error'));

    const result = await checkTargetPrice('600000', 1, 15.0, testDb);
    expect(result).toBeNull();
  });

  it('should send "reached" alert when price exactly equals target', async () => {
    mockGetQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 15.0,
      changePercent: 1.0,
      volume: 1000000,
      timestamp: '2024-01-10T10:00:00Z',
    });

    const result = await checkTargetPrice('600000', 1, 15.0, testDb);
    expect(result).not.toBeNull();
    expect(result!.alertType).toBe('reached');
  });
});

// --- runTargetPriceCheck ---

describe('runTargetPriceCheck', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
    insertUser(testDb, 2);
  });

  it('should check all positions and generate alerts', async () => {
    insertPosition(testDb, 1, '600000', '浦发银行');
    insertAnalysis(testDb, 1, '600000', '浦发银行', JSON.stringify({ targetPrice: 15.0 }), null);

    mockGetQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 15.5,
      changePercent: 2.0,
      volume: 1000000,
      timestamp: '2024-01-10T10:00:00Z',
    });

    const results = await runTargetPriceCheck(testDb);

    expect(results).toHaveLength(1);
    expect(results[0].alertType).toBe('reached');
    expect(results[0].stockCode).toBe('600000');
  });

  it('should skip positions without analysis', async () => {
    insertPosition(testDb, 1, '600000', '浦发银行');
    // No analysis inserted

    const results = await runTargetPriceCheck(testDb);
    expect(results).toHaveLength(0);
  });

  it('should skip positions where analysis has no target price', async () => {
    insertPosition(testDb, 1, '600000', '浦发银行');
    insertAnalysis(testDb, 1, '600000', '浦发银行', null, null);

    const results = await runTargetPriceCheck(testDb);
    expect(results).toHaveLength(0);
  });

  it('should handle multiple users with different positions', async () => {
    insertPosition(testDb, 1, '600000', '浦发银行');
    insertPosition(testDb, 2, '600036', '招商银行');
    insertAnalysis(testDb, 1, '600000', '浦发银行', JSON.stringify({ targetPrice: 15.0 }), null);
    insertAnalysis(testDb, 2, '600036', '招商银行', JSON.stringify({ targetPrice: 35.0 }), null);

    mockGetQuote.mockImplementation(async (code: string) => ({
      stockCode: code,
      stockName: code === '600000' ? '浦发银行' : '招商银行',
      price: code === '600000' ? 16.0 : 32.0,
      changePercent: 1.0,
      volume: 1000000,
      timestamp: '2024-01-10T10:00:00Z',
    }));

    const results = await runTargetPriceCheck(testDb);

    // 600000 reached (16 >= 15), 600036 approaching (32 >= 35*0.9=31.5 but < 35)
    expect(results).toHaveLength(2);
    const reached = results.find(r => r.alertType === 'reached');
    const approaching = results.find(r => r.alertType === 'approaching');
    expect(reached).toBeDefined();
    expect(reached!.stockCode).toBe('600000');
    expect(approaching).toBeDefined();
    expect(approaching!.stockCode).toBe('600036');
  });

  it('should use space_estimate when profit_estimate has no target price', async () => {
    insertPosition(testDb, 1, '600000', '浦发银行');
    insertAnalysis(testDb, 1, '600000', '浦发银行', null, JSON.stringify({ targetPrice: 12.0 }));

    mockGetQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 12.5,
      changePercent: 1.0,
      volume: 1000000,
      timestamp: '2024-01-10T10:00:00Z',
    });

    const results = await runTargetPriceCheck(testDb);
    expect(results).toHaveLength(1);
    expect(results[0].alertType).toBe('reached');
  });

  it('should continue checking other positions when one fails', async () => {
    insertPosition(testDb, 1, '600000', '浦发银行');
    insertPosition(testDb, 1, '600036', '招商银行');
    insertAnalysis(testDb, 1, '600000', '浦发银行', JSON.stringify({ targetPrice: 15.0 }), null);
    insertAnalysis(testDb, 1, '600036', '招商银行', JSON.stringify({ targetPrice: 35.0 }), null);

    let callCount = 0;
    mockGetQuote.mockImplementation(async (code: string) => {
      callCount++;
      if (code === '600000') throw new Error('Network error');
      return {
        stockCode: '600036',
        stockName: '招商银行',
        price: 36.0,
        changePercent: 1.0,
        volume: 1000000,
        timestamp: '2024-01-10T10:00:00Z',
      };
    });

    const results = await runTargetPriceCheck(testDb);
    // Only 600036 should succeed
    expect(results).toHaveLength(1);
    expect(results[0].stockCode).toBe('600036');
  });
});
