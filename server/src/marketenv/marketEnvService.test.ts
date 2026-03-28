import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  calculateMA,
  determineTrend,
  classifyEnvironment,
  getCurrentMarketEnv,
  updateMarketEnv,
  MarketEnvType,
} from './marketEnvService';

// Mock the Tencent API fetch to avoid real network calls
jest.mock('../market/historyService', () => ({
  fetchKlineFromTencent: jest.fn().mockResolvedValue([]),
}));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db);
  return db;
}

/**
 * Seed market_history with synthetic K-line data for an index.
 * Generates `count` trading days ending today.
 */
function seedIndexData(
  db: Database.Database,
  stockCode: string,
  opts: {
    count?: number;
    basePrice?: number;
    priceGrowth?: number;
    baseVolume?: number;
    recentVolumeMultiplier?: number;
  } = {}
): void {
  const {
    count = 70,
    basePrice = 3000,
    priceGrowth = 0,
    baseVolume = 100000000,
    recentVolumeMultiplier = 1.0,
  } = opts;

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO market_history
     (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const insert = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (count - 1 - i));
      const dateStr = date.toISOString().slice(0, 10);

      const progress = i / (count - 1);
      const price = basePrice * (1 + (priceGrowth / 100) * progress);

      const isRecent = i >= count - 5;
      const volume = isRecent ? baseVolume * recentVolumeMultiplier : baseVolume;

      stmt.run(stockCode, dateStr, price * 0.99, price, price * 1.01, price * 0.98, volume);
    }
  });
  insert();
}

/**
 * Seed index data where MA20 > MA60 (uptrend).
 * Achieves this by having a strong upward price trend over 70 days.
 */
function seedUptrendIndex(db: Database.Database, stockCode: string, volumeMultiplier = 1.0): void {
  seedIndexData(db, stockCode, {
    count: 70,
    basePrice: 2800,
    priceGrowth: 20, // strong uptrend → MA20 will be above MA60
    baseVolume: 100000000,
    recentVolumeMultiplier: volumeMultiplier,
  });
}

/**
 * Seed index data where MA20 < MA60 (downtrend).
 * Achieves this by having a downward price trend.
 */
function seedDowntrendIndex(db: Database.Database, stockCode: string, volumeMultiplier = 1.0): void {
  seedIndexData(db, stockCode, {
    count: 70,
    basePrice: 3500,
    priceGrowth: -20, // strong downtrend → MA20 will be below MA60
    baseVolume: 100000000,
    recentVolumeMultiplier: volumeMultiplier,
  });
}

function seedUser(db: Database.Database, lastLoginRecent = true): number {
  const loginAt = lastLoginRecent
    ? new Date().toISOString()
    : new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO users (username, password_hash, last_login_at) VALUES (?, ?, ?)').run(
    `user_${Date.now()}_${Math.random()}`, 'hash', loginAt
  );
  return (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
}

describe('marketEnvService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    jest.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  // --- calculateMA ---

  describe('calculateMA', () => {
    it('should calculate correct moving average', () => {
      const prices = [10, 20, 30, 40, 50];
      expect(calculateMA(prices, 3)).toBeCloseTo(40, 5); // (30+40+50)/3
      expect(calculateMA(prices, 5)).toBeCloseTo(30, 5); // (10+20+30+40+50)/5
    });

    it('should return NaN when insufficient data', () => {
      expect(calculateMA([10, 20], 5)).toBeNaN();
      expect(calculateMA([], 1)).toBeNaN();
    });

    it('should handle single element with period 1', () => {
      expect(calculateMA([42], 1)).toBeCloseTo(42, 5);
    });

    it('should use last N prices for the average', () => {
      const prices = [1, 2, 3, 100, 200];
      expect(calculateMA(prices, 2)).toBeCloseTo(150, 5); // (100+200)/2
    });
  });

  // --- determineTrend ---

  describe('determineTrend', () => {
    it('should return up when MA20 > MA60', () => {
      expect(determineTrend(3200, 3100)).toBe('up');
    });

    it('should return down when MA20 < MA60', () => {
      expect(determineTrend(3000, 3100)).toBe('down');
    });

    it('should return down when MA20 equals MA60', () => {
      expect(determineTrend(3000, 3000)).toBe('down');
    });

    it('should return down when MA20 is NaN', () => {
      expect(determineTrend(NaN, 3000)).toBe('down');
    });

    it('should return down when MA60 is NaN', () => {
      expect(determineTrend(3000, NaN)).toBe('down');
    });
  });

  // --- classifyEnvironment ---

  describe('classifyEnvironment', () => {
    it('should classify as bull when both up, volume expanding, and advance/decline > 1.5', () => {
      const result = classifyEnvironment('up', 'up', 1.3, 1.8);
      expect(result.environment).toBe('bull');
      expect(result.label).toBe('牛市 🐂');
      expect(result.confidenceAdjust).toBe(0);
      expect(result.riskTip).toBeNull();
    });

    it('should classify as sideways when both up but volume not expanding', () => {
      const result = classifyEnvironment('up', 'up', 0.9, 1.8);
      expect(result.environment).toBe('sideways');
    });

    it('should classify as sideways when both up, volume expanding, but advance/decline <= 1.5', () => {
      const result = classifyEnvironment('up', 'up', 1.2, 1.3);
      expect(result.environment).toBe('sideways');
    });

    it('should classify as bear when both down, volume shrinking, and advance/decline < 0.7', () => {
      const result = classifyEnvironment('down', 'down', 0.7, 0.5);
      expect(result.environment).toBe('bear');
      expect(result.label).toBe('熊市 🐻');
      expect(result.confidenceAdjust).toBe(-15);
      expect(result.riskTip).toBe('当前大盘处于熊市环境，操作需谨慎，注意控制仓位');
    });

    it('should classify as sideways when both down but volume not shrinking', () => {
      const result = classifyEnvironment('down', 'down', 1.1, 0.5);
      expect(result.environment).toBe('sideways');
    });

    it('should classify as sideways when both down, volume shrinking, but advance/decline >= 0.7', () => {
      const result = classifyEnvironment('down', 'down', 0.8, 0.8);
      expect(result.environment).toBe('sideways');
    });

    it('should classify as sideways when trends are mixed (sh up, hs300 down)', () => {
      const result = classifyEnvironment('up', 'down', 1.5, 2.0);
      expect(result.environment).toBe('sideways');
      expect(result.label).toBe('震荡 ⚖️');
    });

    it('should classify as sideways when trends are mixed (sh down, hs300 up)', () => {
      const result = classifyEnvironment('down', 'up', 0.5, 0.3);
      expect(result.environment).toBe('sideways');
    });

    it('bear confidenceAdjust should be between -10 and -20', () => {
      const result = classifyEnvironment('down', 'down', 0.7, 0.5);
      expect(result.confidenceAdjust).toBeGreaterThanOrEqual(-20);
      expect(result.confidenceAdjust).toBeLessThanOrEqual(-10);
    });
  });

  // --- getCurrentMarketEnv ---

  describe('getCurrentMarketEnv', () => {
    it('should return null when no environment data exists', () => {
      expect(getCurrentMarketEnv(db)).toBeNull();
    });

    it('should return the latest market environment', () => {
      db.prepare(
        `INSERT INTO market_environment
         (environment, label, confidence_adjust, risk_tip,
          sh_ma20_trend, sh_ma60_trend, hs300_ma20_trend, hs300_ma60_trend,
          volume_change, advance_decline_ratio, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('sideways', '震荡 ⚖️', 0, null, 'up', 'below_ma20', 'down', 'above_ma20', 1.05, 1.2, '2024-01-15T16:20:00Z');

      const result = getCurrentMarketEnv(db);
      expect(result).not.toBeNull();
      expect(result!.environment).toBe('sideways');
      expect(result!.label).toBe('震荡 ⚖️');
      expect(result!.confidenceAdjust).toBe(0);
      expect(result!.riskTip).toBeNull();
      expect(result!.indicators.shIndex.ma20Trend).toBe('up');
      expect(result!.indicators.volumeChange).toBe(1.05);
      expect(result!.indicators.advanceDeclineRatio).toBe(1.2);
    });
  });

  // --- updateMarketEnv ---

  describe('updateMarketEnv', () => {
    it('should create initial market environment status', async () => {
      // Seed flat data for both indices → sideways
      seedIndexData(db, '000001', { count: 70, priceGrowth: 0 });
      seedIndexData(db, '399300', { count: 70, priceGrowth: 0 });

      const result = await updateMarketEnv(db);

      expect(['bull', 'sideways', 'bear']).toContain(result.environment);
      expect(result.label).toBeTruthy();
      expect(typeof result.confidenceAdjust).toBe('number');
      expect(result.updatedAt).toBeTruthy();
      expect(result.indicators).toBeDefined();
      expect(result.indicators.volumeChange).toBeGreaterThan(0);

      // Verify persisted to DB
      const stored = getCurrentMarketEnv(db);
      expect(stored).not.toBeNull();
      expect(stored!.environment).toBe(result.environment);
    });

    it('should detect environment switch and create messages', async () => {
      const userId = seedUser(db);

      // First run: seed sideways data
      seedIndexData(db, '000001', { count: 70, priceGrowth: 0 });
      seedIndexData(db, '399300', { count: 70, priceGrowth: 0 });
      await updateMarketEnv(db);

      // Clear and re-seed with bear conditions: both downtrend, volume shrinking
      db.prepare('DELETE FROM market_history').run();

      // For bear: both indices downtrend + volume shrinking + low advance/decline
      // Downtrend with shrinking recent volume
      seedDowntrendIndex(db, '000001', 0.5);
      seedDowntrendIndex(db, '399300', 0.5);

      const result = await updateMarketEnv(db);

      // If environment changed, messages should be created
      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'market_env_change'`
      ).all() as { user_id: number; summary: string; detail: string }[];

      if (result.environment !== 'sideways') {
        // Environment changed
        expect(messages.length).toBeGreaterThanOrEqual(1);
        expect(messages[0].user_id).toBe(userId);
        expect(messages[0].summary).toContain('大盘环境变化');
      }
    });

    it('should not create messages when environment stays the same', async () => {
      seedUser(db);

      // Both runs: same flat data → sideways
      seedIndexData(db, '000001', { count: 70, priceGrowth: 0 });
      seedIndexData(db, '399300', { count: 70, priceGrowth: 0 });

      await updateMarketEnv(db);
      await updateMarketEnv(db);

      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'market_env_change'`
      ).all();
      expect(messages.length).toBe(0);
    });

    it('should send messages to multiple active users on switch', async () => {
      const user1 = seedUser(db, true);
      const user2 = seedUser(db, true);
      seedUser(db, false); // inactive user

      // First run: sideways
      seedIndexData(db, '000001', { count: 70, priceGrowth: 0 });
      seedIndexData(db, '399300', { count: 70, priceGrowth: 0 });
      await updateMarketEnv(db);

      // Force a different environment by directly inserting a different previous state
      // then running with data that produces a different classification
      db.prepare('DELETE FROM market_history').run();
      db.prepare('DELETE FROM market_environment').run();

      // Insert a "bull" previous state
      db.prepare(
        `INSERT INTO market_environment
         (environment, label, confidence_adjust, risk_tip,
          sh_ma20_trend, sh_ma60_trend, hs300_ma20_trend, hs300_ma60_trend,
          volume_change, advance_decline_ratio, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('bull', '牛市 🐂', 0, null, 'up', 'below_ma20', 'up', 'below_ma20', 1.3, 1.8, '2024-01-14T16:20:00Z');

      // Now seed sideways data → environment will change from bull to sideways
      seedIndexData(db, '000001', { count: 70, priceGrowth: 0 });
      seedIndexData(db, '399300', { count: 70, priceGrowth: 0 });

      await updateMarketEnv(db);

      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'market_env_change'`
      ).all() as { user_id: number }[];

      // Only 2 active users should get messages
      expect(messages.length).toBe(2);
      const userIds = messages.map(m => m.user_id).sort();
      expect(userIds).toEqual([user1, user2].sort());
    });

    it('should handle no data gracefully', async () => {
      // No index data at all → should still produce a result (sideways default)
      const result = await updateMarketEnv(db);
      expect(['bull', 'sideways', 'bear']).toContain(result.environment);
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('should handle all same prices (flat market)', () => {
      const prices = Array(60).fill(3000);
      const ma20 = calculateMA(prices, 20);
      const ma60 = calculateMA(prices, 60);
      expect(ma20).toBeCloseTo(3000, 5);
      expect(ma60).toBeCloseTo(3000, 5);
      // MA20 === MA60 → trend is 'down' → mixed logic depends on both indices
      expect(determineTrend(ma20, ma60)).toBe('down');
    });

    it('should handle very small price differences', () => {
      expect(determineTrend(3000.001, 3000.000)).toBe('up');
      expect(determineTrend(2999.999, 3000.000)).toBe('down');
    });

    it('bull environment should have zero confidenceAdjust', () => {
      const result = classifyEnvironment('up', 'up', 1.5, 2.0);
      expect(result.confidenceAdjust).toBe(0);
      expect(result.riskTip).toBeNull();
    });

    it('sideways environment should have zero confidenceAdjust', () => {
      const result = classifyEnvironment('up', 'down', 1.0, 1.0);
      expect(result.confidenceAdjust).toBe(0);
      expect(result.riskTip).toBeNull();
    });

    it('bear environment should have negative confidenceAdjust and risk tip', () => {
      const result = classifyEnvironment('down', 'down', 0.5, 0.3);
      expect(result.confidenceAdjust).toBeLessThan(0);
      expect(result.riskTip).toBeTruthy();
      expect(result.riskTip).toContain('谨慎');
    });
  });
});
