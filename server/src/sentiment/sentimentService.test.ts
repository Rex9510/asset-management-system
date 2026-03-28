import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  mapVolumeScore,
  mapChangeScore,
  calculateSentimentScore,
  getSentimentLabel,
  getCurrentSentiment,
  updateSentiment,
} from './sentimentService';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db);
  return db;
}

/**
 * Seed market_history with volume data for Shanghai index (000001).
 * Generates `days` trading days ending today.
 */
function seedVolumeData(
  db: Database.Database,
  stockCode: string,
  opts: {
    days?: number;
    baseVolume?: number;
    todayVolume?: number;
  } = {}
): void {
  const { days = 21, baseVolume = 100000000, todayVolume = baseVolume } = opts;

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO market_history
     (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const insert = db.transaction(() => {
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      const dateStr = date.toISOString().slice(0, 10);
      const isToday = i === days - 1;
      const vol = isToday ? todayVolume : baseVolume;
      stmt.run(stockCode, dateStr, 3000, 3010, 3020, 2990, vol);
    }
  });
  insert();
}

/**
 * Seed market_cache with change percent data.
 */
function seedMarketCache(
  db: Database.Database,
  stockCode: string,
  changePercent: number
): void {
  db.prepare(
    `INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(stockCode, stockCode === '000001' ? '上证指数' : '沪深300', 3000, changePercent, 100000000, new Date().toISOString());
}

describe('sentimentService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  // --- mapVolumeScore ---

  describe('mapVolumeScore', () => {
    it('should return 0 for ratio < 0.5', () => {
      expect(mapVolumeScore(0)).toBe(0);
      expect(mapVolumeScore(0.3)).toBe(0);
      expect(mapVolumeScore(0.49)).toBe(0);
    });

    it('should return 0 for ratio exactly 0.5', () => {
      expect(mapVolumeScore(0.5)).toBe(0);
    });

    it('should return 50 for ratio exactly 1.5', () => {
      expect(mapVolumeScore(1.5)).toBe(50);
    });

    it('should linearly map 0.5-1.5 to 0-50', () => {
      expect(mapVolumeScore(1.0)).toBeCloseTo(25, 5);
      expect(mapVolumeScore(0.75)).toBeCloseTo(12.5, 5);
      expect(mapVolumeScore(1.25)).toBeCloseTo(37.5, 5);
    });

    it('should map ratio > 1.5 with 50 + (ratio-1.5)*25', () => {
      expect(mapVolumeScore(2.0)).toBeCloseTo(62.5, 5);
      expect(mapVolumeScore(2.5)).toBeCloseTo(75, 5);
    });

    it('should cap at 100', () => {
      expect(mapVolumeScore(5.0)).toBe(100);
      expect(mapVolumeScore(10.0)).toBe(100);
      expect(mapVolumeScore(3.5)).toBe(100);
    });
  });

  // --- mapChangeScore ---

  describe('mapChangeScore', () => {
    it('should return 0 for change <= -3%', () => {
      expect(mapChangeScore(-3)).toBe(0);
      expect(mapChangeScore(-5)).toBe(0);
      expect(mapChangeScore(-10)).toBe(0);
    });

    it('should return 100 for change >= +3%', () => {
      expect(mapChangeScore(3)).toBe(100);
      expect(mapChangeScore(5)).toBe(100);
      expect(mapChangeScore(10)).toBe(100);
    });

    it('should return 50 for change = 0%', () => {
      expect(mapChangeScore(0)).toBeCloseTo(50, 5);
    });

    it('should linearly map -3% to +3%', () => {
      expect(mapChangeScore(-1.5)).toBeCloseTo(25, 5);
      expect(mapChangeScore(1.5)).toBeCloseTo(75, 5);
    });
  });

  // --- calculateSentimentScore ---

  describe('calculateSentimentScore', () => {
    it('should return integer between 0 and 100', () => {
      const score = calculateSentimentScore(1.0, 0, 0);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should return 0 when all components are at minimum', () => {
      // volumeRatio < 0.5 → 0, change < -3% → 0
      const score = calculateSentimentScore(0.1, -5, -5);
      expect(score).toBe(0);
    });

    it('should return 100 when all components are at maximum', () => {
      // volumeRatio very high → 100, change > +3% → 100
      const score = calculateSentimentScore(10, 5, 5);
      expect(score).toBe(100);
    });

    it('should apply correct weights (40% volume, 30% sh, 30% hs300)', () => {
      // volumeRatio=1.0 → volumeScore=25, shChange=0 → shScore=50, hs300Change=0 → hs300Score=50
      // expected = 25*0.4 + 50*0.3 + 50*0.3 = 10 + 15 + 15 = 40
      const score = calculateSentimentScore(1.0, 0, 0);
      expect(score).toBe(40);
    });

    it('should handle neutral market conditions', () => {
      // volumeRatio=1.0 → 25, shChange=0 → 50, hs300Change=0 → 50
      // 25*0.4 + 50*0.3 + 50*0.3 = 40
      expect(calculateSentimentScore(1.0, 0, 0)).toBe(40);
    });

    it('should handle extreme fear scenario', () => {
      // Low volume + big drops
      const score = calculateSentimentScore(0.3, -4, -4);
      expect(score).toBe(0);
    });

    it('should handle extreme greed scenario', () => {
      // High volume + big gains
      const score = calculateSentimentScore(5, 4, 4);
      expect(score).toBe(100);
    });
  });

  // --- getSentimentLabel ---

  describe('getSentimentLabel', () => {
    it('should return 极度恐慌 for score 0-24', () => {
      expect(getSentimentLabel(0)).toEqual({ label: '极度恐慌', emoji: '😱' });
      expect(getSentimentLabel(10)).toEqual({ label: '极度恐慌', emoji: '😱' });
      expect(getSentimentLabel(24)).toEqual({ label: '极度恐慌', emoji: '😱' });
    });

    it('should return 恐慌 for score 25-44', () => {
      expect(getSentimentLabel(25)).toEqual({ label: '恐慌', emoji: '😰' });
      expect(getSentimentLabel(35)).toEqual({ label: '恐慌', emoji: '😰' });
      expect(getSentimentLabel(44)).toEqual({ label: '恐慌', emoji: '😰' });
    });

    it('should return 中性 for score 45-54', () => {
      expect(getSentimentLabel(45)).toEqual({ label: '中性', emoji: '😐' });
      expect(getSentimentLabel(50)).toEqual({ label: '中性', emoji: '😐' });
      expect(getSentimentLabel(54)).toEqual({ label: '中性', emoji: '😐' });
    });

    it('should return 贪婪 for score 55-74', () => {
      expect(getSentimentLabel(55)).toEqual({ label: '贪婪', emoji: '😊' });
      expect(getSentimentLabel(65)).toEqual({ label: '贪婪', emoji: '😊' });
      expect(getSentimentLabel(74)).toEqual({ label: '贪婪', emoji: '😊' });
    });

    it('should return 极度贪婪 for score 75-100', () => {
      expect(getSentimentLabel(75)).toEqual({ label: '极度贪婪', emoji: '🤑' });
      expect(getSentimentLabel(90)).toEqual({ label: '极度贪婪', emoji: '🤑' });
      expect(getSentimentLabel(100)).toEqual({ label: '极度贪婪', emoji: '🤑' });
    });
  });

  // --- getCurrentSentiment ---

  describe('getCurrentSentiment', () => {
    it('should return null when no sentiment data exists', () => {
      expect(getCurrentSentiment(db)).toBeNull();
    });

    it('should return the latest sentiment data', () => {
      db.prepare(
        `INSERT INTO sentiment_index (score, label, volume_ratio, sh_change_percent, hs300_change_percent, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(48, '中性', 1.05, -0.5, 0.3, '2024-06-15T16:30:00Z');

      const result = getCurrentSentiment(db);
      expect(result).not.toBeNull();
      expect(result!.score).toBe(48);
      expect(result!.label).toBe('中性');
      expect(result!.emoji).toBe('😐');
      expect(result!.components.volumeRatio).toBe(1.05);
      expect(result!.components.shChangePercent).toBe(-0.5);
      expect(result!.components.hs300ChangePercent).toBe(0.3);
      expect(result!.updatedAt).toBe('2024-06-15T16:30:00Z');
    });

    it('should return the most recent entry when multiple exist', () => {
      db.prepare(
        `INSERT INTO sentiment_index (score, label, volume_ratio, sh_change_percent, hs300_change_percent, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(20, '极度恐慌', 0.5, -2, -2, '2024-06-14T16:30:00Z');

      db.prepare(
        `INSERT INTO sentiment_index (score, label, volume_ratio, sh_change_percent, hs300_change_percent, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(80, '极度贪婪', 2.5, 2, 2, '2024-06-15T16:30:00Z');

      const result = getCurrentSentiment(db);
      expect(result!.score).toBe(80);
      expect(result!.label).toBe('极度贪婪');
    });
  });

  // --- updateSentiment ---

  describe('updateSentiment', () => {
    it('should calculate and persist sentiment with market data', () => {
      // Seed volume data: today volume = base volume → ratio ≈ 1.0
      seedVolumeData(db, '000001', { days: 21, baseVolume: 100000000, todayVolume: 100000000 });
      // Seed market cache with change percents
      seedMarketCache(db, '000001', 0);
      seedMarketCache(db, '399300', 0);

      const result = updateSentiment(db);

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(result.score)).toBe(true);
      expect(result.label).toBeTruthy();
      expect(result.emoji).toBeTruthy();
      expect(result.updatedAt).toBeTruthy();

      // Verify persisted to DB
      const stored = getCurrentSentiment(db);
      expect(stored).not.toBeNull();
      expect(stored!.score).toBe(result.score);
      expect(stored!.label).toBe(result.label);
    });

    it('should produce high score with high volume and positive changes', () => {
      // Today volume = 3x base → ratio ≈ 3.0
      seedVolumeData(db, '000001', { days: 21, baseVolume: 100000000, todayVolume: 300000000 });
      seedMarketCache(db, '000001', 2.5);
      seedMarketCache(db, '399300', 2.5);

      const result = updateSentiment(db);
      expect(result.score).toBeGreaterThanOrEqual(60);
    });

    it('should produce low score with low volume and negative changes', () => {
      // Today volume = 0.3x base → ratio ≈ 0.3
      seedVolumeData(db, '000001', { days: 21, baseVolume: 100000000, todayVolume: 30000000 });
      seedMarketCache(db, '000001', -2.5);
      seedMarketCache(db, '399300', -2.5);

      const result = updateSentiment(db);
      expect(result.score).toBeLessThanOrEqual(20);
    });

    it('should handle missing market cache gracefully (defaults to 0 change)', () => {
      seedVolumeData(db, '000001', { days: 21 });
      // No market_cache entries → changes default to 0

      const result = updateSentiment(db);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.components.shChangePercent).toBe(0);
      expect(result.components.hs300ChangePercent).toBe(0);
    });

    it('should handle missing volume data gracefully (defaults to ratio 1)', () => {
      // No market_history data → volumeRatio defaults to 1
      seedMarketCache(db, '000001', 1.0);
      seedMarketCache(db, '399300', 1.0);

      const result = updateSentiment(db);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should handle completely empty database', () => {
      const result = updateSentiment(db);
      // volumeRatio=1 → 25, shChange=0 → 50, hs300Change=0 → 50
      // 25*0.4 + 50*0.3 + 50*0.3 = 40
      expect(result.score).toBe(40);
      expect(result.label).toBe('恐慌');
    });

    it('should round volume_ratio and change_percent to 2 decimal places', () => {
      seedVolumeData(db, '000001', { days: 21, baseVolume: 100000000, todayVolume: 133333333 });
      seedMarketCache(db, '000001', 1.23456);
      seedMarketCache(db, '399300', -0.98765);

      const result = updateSentiment(db);
      // Check that components are rounded
      const decimalPlaces = (n: number) => {
        const str = n.toString();
        const dot = str.indexOf('.');
        return dot === -1 ? 0 : str.length - dot - 1;
      };
      expect(decimalPlaces(result.components.shChangePercent)).toBeLessThanOrEqual(2);
      expect(decimalPlaces(result.components.hs300ChangePercent)).toBeLessThanOrEqual(2);
      expect(decimalPlaces(result.components.volumeRatio)).toBeLessThanOrEqual(2);
    });
  });
});
