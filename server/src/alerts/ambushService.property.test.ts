import * as fc from 'fast-check';
import {
  findLowPositionCandidates,
  parseAIAmbushResponse,
  LowPositionCandidate,
} from './ambushService';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

const candidateArb: fc.Arbitrary<LowPositionCandidate> = fc.record({
  stockCode: fc.constantFrom('600000', '000001', '300750'),
  stockName: fc.constantFrom('浦发银行', '平安银行', '宁德时代'),
  weight: fc.double({ min: 0.1, max: 5, noNaN: true }),
  latestClose: fc.double({ min: 5, max: 100, noNaN: true }),
  rsi6: fc.double({ min: 5, max: 34, noNaN: true }),
  ma20: fc.double({ min: 10, max: 150, noNaN: true }),
  dif: fc.double({ min: -2, max: 2, noNaN: true }),
  dea: fc.double({ min: -2, max: 2, noNaN: true }),
  macdHistogram: fc.double({ min: -1, max: 1, noNaN: true }),
  oversoldScore: fc.double({ min: 5, max: 34, noNaN: true }),
});

describe('属性测试：清仓埋伏候选筛选', () => {
  it('候选标的 RSI6 应 < 35 且价格低于 MA20', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            stockCode: fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 6, maxLength: 6 }).map(s => '600' + s.slice(0, 3)),
            rsi6: fc.double({ min: 5, max: 50, noNaN: true }),
            ma20: fc.double({ min: 10, max: 100, noNaN: true }),
            latestClose: fc.double({ min: 5, max: 100, noNaN: true }),
            dif: fc.double({ min: -1, max: 1, noNaN: true }),
            dea: fc.double({ min: -1, max: 1, noNaN: true }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (stocks) => {
          const db = makeDb();
          for (const s of stocks) {
            db.prepare('INSERT OR IGNORE INTO hs300_constituents (stock_code, stock_name, weight) VALUES (?, ?, 1.0)').run(s.stockCode, '测试');
            db.prepare(
              `INSERT OR REPLACE INTO technical_indicators (stock_code, trade_date, rsi6, ma20, dif, dea, macd_histogram)
               VALUES (?, '2024-06-01', ?, ?, ?, ?, ?)`
            ).run(s.stockCode, s.rsi6, s.ma20, s.dif, s.dea, (s.dif - s.dea) * 2);
            db.prepare(
              `INSERT OR REPLACE INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
               VALUES (?, '2024-06-01', ?, ?, ?, ?, 100000)`
            ).run(s.stockCode, s.latestClose, s.latestClose, s.latestClose * 1.02, s.latestClose * 0.98);
          }

          const candidates = findLowPositionCandidates(db);
          for (const c of candidates) {
            expect(c.rsi6).toBeLessThan(35);
            expect(c.latestClose).toBeLessThan(c.ma20);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it('parseAIAmbushResponse 应返回最多2个推荐', () => {
    const candidates: LowPositionCandidate[] = [
      { stockCode: '600000', stockName: '浦发银行', weight: 2, latestClose: 8, rsi6: 20, ma20: 10, dif: -0.05, dea: 0, macdHistogram: -0.1, oversoldScore: 20 },
      { stockCode: '000001', stockName: '平安银行', weight: 1.5, latestClose: 9, rsi6: 25, ma20: 11, dif: 0.01, dea: 0, macdHistogram: 0.02, oversoldScore: 25 },
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(
          'invalid',
          '[]',
          JSON.stringify([{ stockCode: '600000', stockName: '浦发银行', lowPositionReason: '超卖', reboundPotential: '10%', buyPriceLow: 7.5, buyPriceHigh: 8.2, holdingPeriodRef: '2-4周' }]),
        ),
        (response) => {
          const recs = parseAIAmbushResponse(response, candidates);
          expect(recs.length).toBeLessThanOrEqual(2);
          for (const rec of recs) {
            expect(rec.stockCode).toBeTruthy();
            expect(rec.stockName).toBeTruthy();
            expect(rec.lowPositionReason).toBeTruthy();
            expect(rec.buyPriceRange.low).toBeGreaterThan(0);
            expect(rec.buyPriceRange.high).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 10 }
    );
  });
});
