import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  calculateMA,
  calculateEMASeries,
  calculateMACD,
  calculateKDJ,
  calculateRSI,
  interpretMA,
  interpretMACD,
  interpretKDJ,
  interpretRSI,
  calculateAndCacheIndicators,
  getIndicators,
} from './indicatorService';
import { AppError } from '../errors/AppError';

let testDb: Database.Database;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db);
  return db;
}

/**
 * Generate synthetic market history data for testing.
 * Produces `days` rows of data with predictable close prices.
 */
function insertMarketHistory(db: Database.Database, stockCode: string, days: number, basePrice = 10): void {
  const stmt = db.prepare(
    `INSERT INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const startDate = new Date('2024-01-02');
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    // Create a simple oscillating price pattern
    const variation = Math.sin(i * 0.3) * 2;
    const close = basePrice + variation;
    const open = close - 0.1;
    const high = close + 0.5;
    const low = close - 0.5;
    stmt.run(stockCode, dateStr, open, close, high, low, 1000000 + i * 10000);
  }
}

describe('indicatorService - Pure Calculations', () => {
  describe('calculateMA', () => {
    it('should return null when not enough data', () => {
      expect(calculateMA([1, 2, 3], 5)).toBeNull();
      expect(calculateMA([], 5)).toBeNull();
    });

    it('should calculate MA correctly for exact period length', () => {
      const prices = [10, 12, 14, 16, 18];
      expect(calculateMA(prices, 5)).toBe(14); // (10+12+14+16+18)/5
    });

    it('should use only the last N prices', () => {
      const prices = [1, 2, 10, 12, 14, 16, 18];
      expect(calculateMA(prices, 5)).toBe(14); // (10+12+14+16+18)/5
    });

    it('should handle single-element period', () => {
      expect(calculateMA([42], 1)).toBe(42);
    });
  });

  describe('calculateEMASeries', () => {
    it('should return empty array when not enough data', () => {
      expect(calculateEMASeries([1, 2], 5)).toEqual([]);
    });

    it('should seed with SMA of first period values', () => {
      const prices = [2, 4, 6, 8, 10];
      const ema = calculateEMASeries(prices, 5);
      // SMA of [2,4,6,8,10] = 6
      expect(ema[4]).toBe(6);
    });

    it('should produce correct length output', () => {
      const prices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const ema = calculateEMASeries(prices, 3);
      expect(ema.length).toBe(10);
      // First 2 values should be NaN
      expect(isNaN(ema[0])).toBe(true);
      expect(isNaN(ema[1])).toBe(true);
      expect(isNaN(ema[2])).toBe(false);
    });
  });

  describe('calculateMACD', () => {
    it('should return nulls when not enough data', () => {
      const prices = Array.from({ length: 20 }, (_, i) => 10 + i * 0.1);
      const result = calculateMACD(prices);
      expect(result.dif).toBeNull();
      expect(result.dea).toBeNull();
      expect(result.histogram).toBeNull();
    });

    it('should calculate DIF/DEA/histogram with sufficient data', () => {
      // 60 data points should be enough for full MACD
      const prices = Array.from({ length: 60 }, (_, i) => 10 + Math.sin(i * 0.2) * 2);
      const result = calculateMACD(prices);
      expect(result.dif).not.toBeNull();
      expect(result.dea).not.toBeNull();
      expect(result.histogram).not.toBeNull();
      // histogram = 2 * (dif - dea)
      expect(result.histogram).toBeCloseTo(2 * (result.dif! - result.dea!), 8);
    });

    it('should return dif without dea when 26-33 data points', () => {
      const prices = Array.from({ length: 30 }, (_, i) => 10 + i * 0.1);
      const result = calculateMACD(prices);
      expect(result.dif).not.toBeNull();
      // 30 - 25 = 5 DIF values, not enough for EMA9
      expect(result.dea).toBeNull();
    });
  });

  describe('calculateKDJ', () => {
    it('should return nulls when not enough data', () => {
      const result = calculateKDJ([1, 2], [0.5, 1], [0.8, 1.5]);
      expect(result.k).toBeNull();
      expect(result.d).toBeNull();
      expect(result.j).toBeNull();
    });

    it('should calculate KDJ with sufficient data', () => {
      const n = 20;
      const highs = Array.from({ length: n }, (_, i) => 12 + Math.sin(i * 0.3));
      const lows = Array.from({ length: n }, (_, i) => 8 + Math.sin(i * 0.3));
      const closes = Array.from({ length: n }, (_, i) => 10 + Math.sin(i * 0.3));
      const result = calculateKDJ(highs, lows, closes);
      expect(result.k).not.toBeNull();
      expect(result.d).not.toBeNull();
      expect(result.j).not.toBeNull();
      // J = 3K - 2D
      expect(result.j).toBeCloseTo(3 * result.k! - 2 * result.d!, 8);
    });

    it('should handle flat prices (range = 0)', () => {
      const n = 10;
      const highs = Array(n).fill(10);
      const lows = Array(n).fill(10);
      const closes = Array(n).fill(10);
      const result = calculateKDJ(highs, lows, closes);
      // When range is 0, RSV defaults to 50
      expect(result.k).not.toBeNull();
      expect(result.k).toBeCloseTo(50, 8); // stays at initial 50 since RSV is always 50
    });
  });

  describe('calculateRSI', () => {
    it('should return null when not enough data', () => {
      expect(calculateRSI([1, 2, 3], 6)).toBeNull();
    });

    it('should return 100 when all changes are gains', () => {
      const prices = [1, 2, 3, 4, 5, 6, 7, 8];
      expect(calculateRSI(prices, 6)).toBe(100);
    });

    it('should return value between 0 and 100', () => {
      const prices = Array.from({ length: 30 }, (_, i) => 10 + Math.sin(i * 0.5) * 3);
      const rsi = calculateRSI(prices, 6);
      expect(rsi).not.toBeNull();
      expect(rsi!).toBeGreaterThanOrEqual(0);
      expect(rsi!).toBeLessThanOrEqual(100);
    });

    it('should calculate RSI for different periods', () => {
      const prices = Array.from({ length: 60 }, (_, i) => 10 + Math.sin(i * 0.3) * 2);
      const rsi6 = calculateRSI(prices, 6);
      const rsi12 = calculateRSI(prices, 12);
      const rsi24 = calculateRSI(prices, 24);
      expect(rsi6).not.toBeNull();
      expect(rsi12).not.toBeNull();
      expect(rsi24).not.toBeNull();
    });
  });
});

describe('indicatorService - Signal Interpretation', () => {
  describe('interpretMA', () => {
    it('should return bullish when price is above MA20 by >2%', () => {
      expect(interpretMA(10.5, 10).direction).toBe('bullish');
    });

    it('should return bearish when price is below MA20 by >2%', () => {
      expect(interpretMA(9.5, 10).direction).toBe('bearish');
    });

    it('should return neutral when price is near MA20', () => {
      expect(interpretMA(10.1, 10).direction).toBe('neutral');
    });

    it('should return neutral when MA20 is null', () => {
      expect(interpretMA(10, null).direction).toBe('neutral');
    });
  });

  describe('interpretMACD', () => {
    it('should return bullish for golden cross (DIF > DEA, DIF > 0)', () => {
      expect(interpretMACD(0.5, 0.2).direction).toBe('bullish');
    });

    it('should return bearish for death cross (DIF < DEA, DIF < 0)', () => {
      expect(interpretMACD(-0.5, -0.2).direction).toBe('bearish');
    });

    it('should return neutral when DIF and DEA are very close', () => {
      expect(interpretMACD(0.005, 0.002).direction).toBe('neutral');
    });

    it('should return neutral when data is null', () => {
      expect(interpretMACD(null, null).direction).toBe('neutral');
    });
  });

  describe('interpretKDJ', () => {
    it('should return bullish when oversold (K < D, J < 20)', () => {
      expect(interpretKDJ(15, 20, 10).direction).toBe('bullish');
    });

    it('should return bearish when overbought (K > D, J > 80)', () => {
      expect(interpretKDJ(85, 80, 90).direction).toBe('bearish');
    });

    it('should return neutral in middle range', () => {
      expect(interpretKDJ(50, 50, 50).direction).toBe('neutral');
    });

    it('should return neutral when data is null', () => {
      expect(interpretKDJ(null, null, null).direction).toBe('neutral');
    });
  });

  describe('interpretRSI', () => {
    it('should return bearish when RSI > 70', () => {
      expect(interpretRSI(75).direction).toBe('bearish');
    });

    it('should return bullish when RSI < 30', () => {
      expect(interpretRSI(25).direction).toBe('bullish');
    });

    it('should return neutral when RSI is in middle range', () => {
      expect(interpretRSI(50).direction).toBe('neutral');
    });

    it('should return neutral when RSI is null', () => {
      expect(interpretRSI(null).direction).toBe('neutral');
    });
  });
});

describe('indicatorService - Database Operations', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  describe('calculateAndCacheIndicators', () => {
    it('should throw for invalid stock code', () => {
      expect(() => calculateAndCacheIndicators('999999', testDb)).toThrow(AppError);
    });

    it('should throw when no market history exists', () => {
      expect(() => calculateAndCacheIndicators('600000', testDb)).toThrow(AppError);
    });

    it('should calculate and cache indicators with sufficient data', () => {
      insertMarketHistory(testDb, '600000', 70);
      const result = calculateAndCacheIndicators('600000', testDb);
      expect(result).not.toBeNull();
      expect(result!.stockCode).toBe('600000');
      expect(result!.ma.ma5).not.toBeNull();
      expect(result!.ma.ma60).not.toBeNull();
      expect(result!.macd.dif).not.toBeNull();
      expect(result!.kdj.k).not.toBeNull();
      expect(result!.rsi.rsi6).not.toBeNull();
      expect(result!.signals).toBeDefined();

      // Verify data was cached in DB
      const cached = testDb
        .prepare('SELECT * FROM technical_indicators WHERE stock_code = ?')
        .get('600000');
      expect(cached).toBeDefined();
    });

    it('should handle partial data (less than 60 days)', () => {
      insertMarketHistory(testDb, '600000', 15);
      const result = calculateAndCacheIndicators('600000', testDb);
      expect(result).not.toBeNull();
      expect(result!.ma.ma5).not.toBeNull();
      expect(result!.ma.ma10).not.toBeNull();
      expect(result!.ma.ma60).toBeNull(); // Not enough data for MA60
    });

    it('should update cached data on recalculation', async () => {
      insertMarketHistory(testDb, '600000', 70);
      const first = calculateAndCacheIndicators('600000', testDb);

      // Wait a small amount to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      // Add more data
      const stmt = testDb.prepare(
        `INSERT INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      stmt.run('600000', '2024-04-15', 15, 15.5, 16, 14.5, 2000000);

      const second = calculateAndCacheIndicators('600000', testDb);
      expect(second!.tradeDate).toBe('2024-04-15');
      expect(second!.updatedAt).not.toBe(first!.updatedAt);
    });
  });

  describe('getIndicators', () => {
    it('should throw for invalid stock code', () => {
      expect(() => getIndicators('999999', testDb)).toThrow(AppError);
    });

    it('should calculate on first call and return cached on second', () => {
      insertMarketHistory(testDb, '600000', 70);
      const first = getIndicators('600000', testDb);
      expect(first.stockCode).toBe('600000');
      expect(first.signals).toBeDefined();

      // Second call should return cached data
      const second = getIndicators('600000', testDb);
      expect(second.stockCode).toBe('600000');
      expect(second.tradeDate).toBe(first.tradeDate);
    });

    it('should include all signal fields', () => {
      insertMarketHistory(testDb, '600000', 70);
      const result = getIndicators('600000', testDb);
      expect(result.signals.ma).toHaveProperty('direction');
      expect(result.signals.ma).toHaveProperty('label');
      expect(result.signals.macd).toHaveProperty('direction');
      expect(result.signals.macd).toHaveProperty('label');
      expect(result.signals.kdj).toHaveProperty('direction');
      expect(result.signals.kdj).toHaveProperty('label');
      expect(result.signals.rsi).toHaveProperty('direction');
      expect(result.signals.rsi).toHaveProperty('label');
    });
  });
});
