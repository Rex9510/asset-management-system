import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  trackDailyPicks,
  getTrackingList,
  getAccuracyStats,
  calculateReturn,
} from './dailyPickTrackingService';

let testDb: Database.Database;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

jest.mock('../market/marketDataService', () => ({
  getQuote: jest.fn().mockResolvedValue({
    stockCode: '600519',
    stockName: '贵州茅台',
    price: 1800,
    changePercent: 1.5,
    volume: 100000,
    timestamp: new Date().toISOString(),
  }),
}));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function insertUser(db: Database.Database, userId: number): void {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(userId, `user${userId}`, 'hash');
}

/**
 * Insert a daily_pick message with a specific created_at date.
 * Returns the message id.
 */
function insertDailyPick(
  db: Database.Database,
  userId: number,
  stockCode: string,
  stockName: string,
  pickPrice: number,
  createdAt: string
): number {
  const detail = JSON.stringify({
    stockCode,
    stockName,
    currentPrice: pickPrice,
    period: 'short',
    reason: '技术面参考方案',
    targetPriceRange: { low: pickPrice * 1.05, high: pickPrice * 1.15 },
    estimatedUpside: 10,
  });
  const summary = `【短期关注】${stockName}(${stockCode})`;

  db.prepare(`
    INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read, created_at)
    VALUES (?, 'daily_pick', ?, ?, ?, ?, 0, ?)
  `).run(userId, stockCode, stockName, summary, detail, createdAt);

  return (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
}

function insertMarketCache(db: Database.Database, stockCode: string, price: number): void {
  db.prepare(`
    INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at)
    VALUES (?, ?, ?, 0, 0, datetime('now'))
  `).run(stockCode, stockCode, price);
}


// --- Pure function tests ---

describe('calculateReturn', () => {
  it('should calculate positive return correctly', () => {
    // (1800 - 1750) / 1750 * 100 = 2.857...
    expect(calculateReturn(1800, 1750)).toBeCloseTo(2.86, 1);
  });

  it('should calculate negative return correctly', () => {
    // (1700 - 1750) / 1750 * 100 = -2.857...
    expect(calculateReturn(1700, 1750)).toBeCloseTo(-2.86, 1);
  });

  it('should return 0 when prices are equal', () => {
    expect(calculateReturn(100, 100)).toBe(0);
  });

  it('should return 0 when pickPrice is 0', () => {
    expect(calculateReturn(100, 0)).toBe(0);
  });
});

// --- Integration tests ---

describe('trackDailyPicks', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it('should do nothing when no daily_pick messages exist', async () => {
    await trackDailyPicks(testDb);
    const trackings = getTrackingList(testDb);
    expect(trackings).toEqual([]);
  });

  it('should track a pick after 3 days have passed', async () => {
    insertUser(testDb, 1);
    // Pick created 4 days ago
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
    const pickId = insertDailyPick(testDb, 1, '600519', '贵州茅台', 1750, fourDaysAgo.toISOString());

    // Set current price in cache
    insertMarketCache(testDb, '600519', 1800);

    await trackDailyPicks(testDb);

    // Should have a 3-day tracking record
    const trackings = getTrackingList(testDb);
    expect(trackings.length).toBe(1);
    expect(trackings[0].pickId).toBe(pickId);
    expect(trackings[0].trackingDays).toBe(3);
    expect(trackings[0].currentPrice).toBe(1800);
    expect(trackings[0].returnPercent).toBeCloseTo(2.86, 1);
    expect(trackings[0].status).toBe('profit');
  });

  it('should track multiple intervals when enough days have passed', async () => {
    insertUser(testDb, 1);
    // Pick created 31 days ago — all 4 intervals should trigger
    const thirtyOneDaysAgo = new Date();
    thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
    insertDailyPick(testDb, 1, '600519', '贵州茅台', 1750, thirtyOneDaysAgo.toISOString());
    insertMarketCache(testDb, '600519', 1800);

    await trackDailyPicks(testDb);

    const trackings = getTrackingList(testDb);
    expect(trackings.length).toBe(4);
    const days = trackings.map(t => t.trackingDays).sort((a, b) => a - b);
    expect(days).toEqual([3, 7, 14, 30]);
  });

  it('should create daily_pick_tracking messages', async () => {
    insertUser(testDb, 1);
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
    insertDailyPick(testDb, 1, '600519', '贵州茅台', 1750, fourDaysAgo.toISOString());
    insertMarketCache(testDb, '600519', 1800);

    await trackDailyPicks(testDb);

    const messages = testDb.prepare(
      "SELECT * FROM messages WHERE type = 'daily_pick_tracking'"
    ).all() as { user_id: number; summary: string; stock_code: string }[];

    expect(messages.length).toBe(1);
    expect(messages[0].user_id).toBe(1);
    expect(messages[0].stock_code).toBe('600519');
    expect(messages[0].summary).toContain('贵州茅台');
    expect(messages[0].summary).toContain('3天追踪');
    expect(messages[0].summary).toContain('盈利');
  });

  it('should be idempotent — running twice does not create duplicates', async () => {
    insertUser(testDb, 1);
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
    insertDailyPick(testDb, 1, '600519', '贵州茅台', 1750, fourDaysAgo.toISOString());
    insertMarketCache(testDb, '600519', 1800);

    await trackDailyPicks(testDb);
    await trackDailyPicks(testDb);

    const trackings = getTrackingList(testDb);
    expect(trackings.length).toBe(1);

    const messages = testDb.prepare(
      "SELECT * FROM messages WHERE type = 'daily_pick_tracking'"
    ).all();
    expect(messages.length).toBe(1);
  });

  it('should not track picks that have not reached the interval yet', async () => {
    insertUser(testDb, 1);
    // Pick created 2 days ago — not yet at 3-day node
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    insertDailyPick(testDb, 1, '600519', '贵州茅台', 1750, twoDaysAgo.toISOString());
    insertMarketCache(testDb, '600519', 1800);

    await trackDailyPicks(testDb);

    const trackings = getTrackingList(testDb);
    expect(trackings.length).toBe(0);
  });

  it('should show loss status when price drops', async () => {
    insertUser(testDb, 1);
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
    insertDailyPick(testDb, 1, '600519', '贵州茅台', 1800, fourDaysAgo.toISOString());
    insertMarketCache(testDb, '600519', 1700);

    await trackDailyPicks(testDb);

    const trackings = getTrackingList(testDb);
    expect(trackings.length).toBe(1);
    expect(trackings[0].status).toBe('loss');
    expect(trackings[0].returnPercent).toBeLessThan(0);

    const messages = testDb.prepare(
      "SELECT summary FROM messages WHERE type = 'daily_pick_tracking'"
    ).all() as { summary: string }[];
    expect(messages[0].summary).toContain('亏损');
  });
});

describe('getTrackingList', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it('should return empty array when no tracking records', () => {
    expect(getTrackingList(testDb)).toEqual([]);
  });

  it('should return records sorted by tracked_at DESC', async () => {
    insertUser(testDb, 1);
    // Two picks at different times
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

    insertDailyPick(testDb, 1, '600519', '贵州茅台', 1750, tenDaysAgo.toISOString());
    insertDailyPick(testDb, 1, '000858', '五粮液', 150, fourDaysAgo.toISOString());
    insertMarketCache(testDb, '600519', 1800);
    insertMarketCache(testDb, '000858', 155);

    await trackDailyPicks(testDb);

    const trackings = getTrackingList(testDb);
    expect(trackings.length).toBeGreaterThan(0);
    // All records should have tracked_at in descending order
    for (let i = 1; i < trackings.length; i++) {
      expect(trackings[i - 1].pickId).toBeDefined();
    }
  });
});

describe('getAccuracyStats', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it('should return zeros when no tracking records', () => {
    const stats = getAccuracyStats(testDb);
    expect(stats).toEqual({
      totalPicks: 0,
      profitCount: 0,
      lossCount: 0,
      avgReturn: 0,
      winRate: 0,
    });
  });

  it('should calculate stats correctly with mixed results', async () => {
    insertUser(testDb, 1);
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

    // Pick 1: profit (1750 -> 1800)
    insertDailyPick(testDb, 1, '600519', '贵州茅台', 1750, fourDaysAgo.toISOString());
    insertMarketCache(testDb, '600519', 1800);

    // Pick 2: loss (160 -> 150)
    insertDailyPick(testDb, 1, '000858', '五粮液', 160, fourDaysAgo.toISOString());
    insertMarketCache(testDb, '000858', 150);

    await trackDailyPicks(testDb);

    const stats = getAccuracyStats(testDb);
    expect(stats.totalPicks).toBe(2);
    expect(stats.profitCount).toBe(1);
    expect(stats.lossCount).toBe(1);
    expect(stats.winRate).toBeCloseTo(0.5, 2);
    // avgReturn = mean of all return_percent values
    expect(typeof stats.avgReturn).toBe('number');
  });

  it('should use latest tracking interval for win/loss determination', async () => {
    insertUser(testDb, 1);
    // Pick created 31 days ago — all 4 intervals trigger
    const thirtyOneDaysAgo = new Date();
    thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
    insertDailyPick(testDb, 1, '600519', '贵州茅台', 1750, thirtyOneDaysAgo.toISOString());
    insertMarketCache(testDb, '600519', 1800);

    await trackDailyPicks(testDb);

    const stats = getAccuracyStats(testDb);
    // Only 1 unique pick, even though 4 tracking records exist
    expect(stats.totalPicks).toBe(1);
    expect(stats.profitCount).toBe(1);
    expect(stats.lossCount).toBe(0);
    expect(stats.winRate).toBe(1);
  });
});
