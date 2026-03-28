import * as fc from 'fast-check';
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
} from './indicatorService';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

// Arbitrary for positive price series
const priceArb = fc.double({ min: 1, max: 500, noNaN: true }).map(v => Math.round(v * 100) / 100);
const priceSeries = (minLen: number) => fc.array(priceArb, { minLength: minLen, maxLength: 120 });

describe('属性测试：技术指标计算正确性', () => {
  it('MA(N) 应等于最后N个价格的算术平均值', () => {
    fc.assert(
      fc.property(
        priceSeries(5),
        fc.constantFrom(5, 10, 20),
        (prices, period) => {
          if (prices.length < period) {
            expect(calculateMA(prices, period)).toBeNull();
            return;
          }
          const ma = calculateMA(prices, period)!;
          const slice = prices.slice(-period);
          const expected = slice.reduce((s, v) => s + v, 0) / period;
          expect(Math.abs(ma - expected)).toBeLessThan(0.0001);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('EMA 序列长度应等于输入长度（当数据足够时）', () => {
    fc.assert(
      fc.property(priceSeries(12), (prices) => {
        const ema = calculateEMASeries(prices, 12);
        if (prices.length < 12) {
          expect(ema.length).toBe(0);
        } else {
          expect(ema.length).toBe(prices.length);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('MACD 在数据不足26天时应返回null', () => {
    fc.assert(
      fc.property(
        fc.array(priceArb, { minLength: 1, maxLength: 25 }),
        (prices) => {
          const { dif, dea, histogram } = calculateMACD(prices);
          expect(dif).toBeNull();
          expect(dea).toBeNull();
          expect(histogram).toBeNull();
        }
      ),
      { numRuns: 30 }
    );
  });

  it('KDJ 的 K/D 值应在 0-100 范围内（当数据足够时）', () => {
    fc.assert(
      fc.property(priceSeries(20), (prices) => {
        if (prices.length < 9) return;
        const highs = prices.map(p => p * 1.02);
        const lows = prices.map(p => p * 0.98);
        const { k, d } = calculateKDJ(highs, lows, prices);
        if (k !== null) {
          expect(k).toBeGreaterThanOrEqual(0);
          expect(k).toBeLessThanOrEqual(100);
        }
        if (d !== null) {
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('RSI 值应在 0-100 范围内', () => {
    fc.assert(
      fc.property(priceSeries(15), fc.constantFrom(6, 12, 24), (prices, period) => {
        const rsi = calculateRSI(prices, period);
        if (rsi !== null) {
          expect(rsi).toBeGreaterThanOrEqual(0);
          expect(rsi).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('属性测试：行情更新触发指标重算', () => {
  it('插入行情数据后 calculateAndCacheIndicators 应返回有效指标', () => {
    fc.assert(
      fc.property(
        priceSeries(30),
        (prices) => {
          const db = makeDb();
          const stockCode = '600000';

          // Insert market history
          for (let i = 0; i < prices.length; i++) {
            const date = `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
            const p = prices[i];
            db.prepare(
              `INSERT OR REPLACE INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).run(stockCode, date, p * 0.99, p, p * 1.02, p * 0.97, 100000 + i * 1000);
          }

          const result = calculateAndCacheIndicators(stockCode, db);
          expect(result).not.toBeNull();
          expect(result!.stockCode).toBe(stockCode);
          // MA5 should exist if we have >= 5 data points
          if (prices.length >= 5) {
            expect(result!.ma.ma5).not.toBeNull();
          }
          // Signals should always be present
          expect(result!.signals).toBeDefined();
          expect(result!.signals.ma).toBeDefined();
          expect(result!.signals.macd).toBeDefined();
          expect(result!.signals.kdj).toBeDefined();
          expect(result!.signals.rsi).toBeDefined();
        }
      ),
      { numRuns: 20 }
    );
  });
});
