import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  calculateETFScore,
  determinePhase,
  updateRotationStatus,
  getCurrentRotation,
  Phase,
} from './rotationService';

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
 * Seed market_history with synthetic K-line data for an ETF.
 * Generates `count` trading days ending today, with configurable price trend and volume.
 */
function seedKlineData(
  db: Database.Database,
  stockCode: string,
  opts: {
    count?: number;
    basePrice?: number;
    priceGrowth?: number; // total % growth over the period
    baseVolume?: number;
    recentVolumeMultiplier?: number; // multiplier for last 5 days volume vs rest
  } = {}
): void {
  const {
    count = 25,
    basePrice = 1.0,
    priceGrowth = 10,
    baseVolume = 1000000,
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

      // Linear price growth
      const progress = i / (count - 1);
      const price = basePrice * (1 + (priceGrowth / 100) * progress);

      // Volume: higher for last 5 days if multiplier > 1
      const isRecent = i >= count - 5;
      const volume = isRecent ? baseVolume * recentVolumeMultiplier : baseVolume;

      stmt.run(stockCode, dateStr, price * 0.99, price, price * 1.01, price * 0.98, volume);
    }
  });
  insert();
}

function seedUser(db: Database.Database, lastLoginRecent = true): number {
  const loginAt = lastLoginRecent
    ? new Date().toISOString()
    : new Date(Date.now() - 48 * 3600 * 1000).toISOString(); // 48h ago
  db.prepare('INSERT INTO users (username, password_hash, last_login_at) VALUES (?, ?, ?)').run(
    `user_${Date.now()}_${Math.random()}`, 'hash', loginAt
  );
  return (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
}

describe('rotationService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    jest.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  // --- determinePhase ---

  describe('determinePhase', () => {
    it('should return P1 when tech has highest score', () => {
      const result = determinePhase({ tech: 10, cycle: 5, consumer: 3 });
      expect(result.phase).toBe('P1');
      expect(result.label).toBe('科技成长');
    });

    it('should return P2 when cycle has highest score', () => {
      const result = determinePhase({ tech: 2, cycle: 8, consumer: 5 });
      expect(result.phase).toBe('P2');
      expect(result.label).toBe('周期品');
    });

    it('should return P3 when consumer has highest score', () => {
      const result = determinePhase({ tech: 1, cycle: 3, consumer: 12 });
      expect(result.phase).toBe('P3');
      expect(result.label).toBe('消费白酒');
    });

    it('should handle negative scores', () => {
      const result = determinePhase({ tech: -5, cycle: -2, consumer: -10 });
      expect(result.phase).toBe('P2');
      expect(result.label).toBe('周期品');
    });

    it('should handle all equal scores (defaults to tech/P1)', () => {
      const result = determinePhase({ tech: 5, cycle: 5, consumer: 5 });
      // On tie, original order is preserved: tech first
      expect(result.phase).toBe('P1');
    });

    it('should handle zero scores', () => {
      const result = determinePhase({ tech: 0, cycle: 0, consumer: 0 });
      expect(result.phase).toBe('P1');
    });
  });

  // --- calculateETFScore ---

  describe('calculateETFScore', () => {
    it('should calculate score from DB K-line data', async () => {
      // Seed 25 days of data with 10% growth and normal volume
      seedKlineData(db, '515000', {
        count: 25,
        basePrice: 1.0,
        priceGrowth: 10,
        baseVolume: 1000000,
        recentVolumeMultiplier: 1.0,
      });

      const result = await calculateETFScore('515000', db);

      expect(result.change20d).toBeGreaterThan(0);
      expect(result.volumeRatio).toBeCloseTo(1.0, 0);
      expect(typeof result.score).toBe('number');
    });

    it('should reflect higher volume ratio when recent volume is elevated', async () => {
      seedKlineData(db, '515000', {
        count: 25,
        basePrice: 1.0,
        priceGrowth: 5,
        baseVolume: 1000000,
        recentVolumeMultiplier: 2.0, // last 5 days have 2x volume
      });

      const result = await calculateETFScore('515000', db);

      // Volume ratio should be > 1 since recent 5-day avg is higher than 20-day avg
      expect(result.volumeRatio).toBeGreaterThan(1);
    });

    it('should return zero score when no data available', async () => {
      const result = await calculateETFScore('515000', db);
      expect(result.change20d).toBe(0);
      expect(result.volumeRatio).toBe(1);
      expect(result.score).toBe(0);
    });

    it('should handle minimal data (2 rows)', async () => {
      const stmt = db.prepare(
        `INSERT INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      stmt.run('515000', yesterday.toISOString().slice(0, 10), 1.0, 1.0, 1.1, 0.9, 1000000);
      stmt.run('515000', today.toISOString().slice(0, 10), 1.0, 1.1, 1.2, 0.95, 1200000);

      const result = await calculateETFScore('515000', db);
      // With only 2 data points, change20d = (1.1 - 1.0) / 1.0 * 100 = 10
      expect(result.change20d).toBeGreaterThanOrEqual(0);
      expect(typeof result.score).toBe('number');
    });
  });

  // --- getCurrentRotation ---

  describe('getCurrentRotation', () => {
    it('should return null when no rotation status exists', () => {
      expect(getCurrentRotation(db)).toBeNull();
    });

    it('should return the latest rotation status', () => {
      db.prepare(
        `INSERT INTO rotation_status
         (current_phase, phase_label, tech_change_20d, tech_volume_ratio,
          cycle_change_20d, cycle_volume_ratio, consumer_change_20d, consumer_volume_ratio,
          previous_phase, switched_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('P1', '科技成长', 5.5, 1.2, 2.0, 0.9, 1.0, 0.8, null, null, '2024-01-15T16:00:00Z');

      const result = getCurrentRotation(db);
      expect(result).not.toBeNull();
      expect(result!.currentPhase).toBe('P1');
      expect(result!.phaseLabel).toBe('科技成长');
      expect(result!.etfPerformance.tech.code).toBe('515000');
      expect(result!.etfPerformance.tech.change20d).toBe(5.5);
      expect(result!.etfPerformance.cycle.code).toBe('512400');
      expect(result!.etfPerformance.consumer.code).toBe('159928');
      expect(result!.previousPhase).toBeNull();
    });
  });

  // --- updateRotationStatus ---

  describe('updateRotationStatus', () => {
    it('should create initial rotation status', async () => {
      // Seed K-line data for all 3 ETFs
      seedKlineData(db, '515000', { priceGrowth: 15, recentVolumeMultiplier: 1.5 });
      seedKlineData(db, '512400', { priceGrowth: 5, recentVolumeMultiplier: 1.0 });
      seedKlineData(db, '159928', { priceGrowth: 3, recentVolumeMultiplier: 0.8 });

      const result = await updateRotationStatus(db);

      expect(result.currentPhase).toBe('P1'); // tech has highest growth
      expect(result.phaseLabel).toBe('科技成长');
      expect(result.previousPhase).toBeNull(); // first run
      expect(result.etfPerformance.tech.code).toBe('515000');
      expect(result.etfPerformance.cycle.code).toBe('512400');
      expect(result.etfPerformance.consumer.code).toBe('159928');

      // Verify persisted to DB
      const stored = getCurrentRotation(db);
      expect(stored).not.toBeNull();
      expect(stored!.currentPhase).toBe('P1');
    });

    it('should detect phase switch and create messages', async () => {
      const userId = seedUser(db);

      // First run: P1 (tech leads)
      seedKlineData(db, '515000', { priceGrowth: 15, recentVolumeMultiplier: 1.5 });
      seedKlineData(db, '512400', { priceGrowth: 5 });
      seedKlineData(db, '159928', { priceGrowth: 3 });
      await updateRotationStatus(db);

      // Clear K-line data and re-seed with cycle leading
      db.prepare('DELETE FROM market_history').run();
      seedKlineData(db, '515000', { priceGrowth: 2 });
      seedKlineData(db, '512400', { priceGrowth: 20, recentVolumeMultiplier: 2.0 });
      seedKlineData(db, '159928', { priceGrowth: 3 });

      const result = await updateRotationStatus(db);

      expect(result.currentPhase).toBe('P2');
      expect(result.phaseLabel).toBe('周期品');
      expect(result.previousPhase).toBe('P1');
      expect(result.switchedAt).not.toBeNull();

      // Verify rotation_switch message was created
      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'rotation_switch'`
      ).all() as { user_id: number; summary: string; detail: string }[];

      expect(messages.length).toBe(1);
      expect(messages[0].user_id).toBe(userId);
      expect(messages[0].summary).toContain('科技成长');
      expect(messages[0].summary).toContain('周期品');

      const detail = JSON.parse(messages[0].detail);
      expect(detail.previousPhase).toBe('P1');
      expect(detail.currentPhase).toBe('P2');
    });

    it('should not create messages when phase stays the same', async () => {
      seedUser(db);

      // Both runs: tech leads
      seedKlineData(db, '515000', { priceGrowth: 15, recentVolumeMultiplier: 1.5 });
      seedKlineData(db, '512400', { priceGrowth: 5 });
      seedKlineData(db, '159928', { priceGrowth: 3 });

      await updateRotationStatus(db);
      await updateRotationStatus(db);

      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'rotation_switch'`
      ).all();
      expect(messages.length).toBe(0);
    });

    it('should send messages to multiple active users on switch', async () => {
      const user1 = seedUser(db, true);
      const user2 = seedUser(db, true);
      seedUser(db, false); // inactive user — 48h ago

      // First run: P1
      seedKlineData(db, '515000', { priceGrowth: 15, recentVolumeMultiplier: 1.5 });
      seedKlineData(db, '512400', { priceGrowth: 5 });
      seedKlineData(db, '159928', { priceGrowth: 3 });
      await updateRotationStatus(db);

      // Switch to P3
      db.prepare('DELETE FROM market_history').run();
      seedKlineData(db, '515000', { priceGrowth: 1 });
      seedKlineData(db, '512400', { priceGrowth: 2 });
      seedKlineData(db, '159928', { priceGrowth: 20, recentVolumeMultiplier: 2.0 });

      await updateRotationStatus(db);

      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'rotation_switch'`
      ).all() as { user_id: number }[];

      // Only 2 active users should get messages
      expect(messages.length).toBe(2);
      const userIds = messages.map(m => m.user_id).sort();
      expect(userIds).toEqual([user1, user2].sort());
    });
  });
});
