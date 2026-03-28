import * as fc from 'fast-check';
import {
  checkMACDCondition,
  checkRSICondition,
  checkVolumeExpansion,
  checkPriceNearMA20,
  parseAIPicksResponse,
  CandidateStock,
  DailyPick,
} from './dailyPickService';
import { MarketHistoryRow } from '../indicators/indicatorService';

const candidateArb: fc.Arbitrary<CandidateStock> = fc.record({
  stockCode: fc.constantFrom('600000', '000001', '300750'),
  stockName: fc.constantFrom('浦发银行', '平安银行', '宁德时代'),
  weight: fc.double({ min: 0.1, max: 5, noNaN: true }),
  latestClose: fc.double({ min: 5, max: 200, noNaN: true }),
  indicators: fc.record({
    macdGoldenCross: fc.boolean(),
    macdNearCross: fc.boolean(),
    rsiInRange: fc.boolean(),
    volumeExpanding: fc.boolean(),
    priceAboveMA20: fc.boolean(),
  }),
  matchCount: fc.integer({ min: 3, max: 4 }),
});

describe('属性测试：每日关注候选过滤条件', () => {
  it('MACD 金叉判断：DIF > DEA 时 goldenCross 为 true', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        (dif, dea) => {
          const { goldenCross, nearCross } = checkMACDCondition(dif, dea);
          if (dif > dea) {
            expect(goldenCross).toBe(true);
            expect(nearCross).toBe(false);
          }
          if (dif <= dea && (dea - dif) < 0.05) {
            expect(nearCross).toBe(true);
            expect(goldenCross).toBe(false);
          }
          // null inputs
          expect(checkMACDCondition(null, null).goldenCross).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('RSI 健康区间：30-70 返回 true，其他返回 false', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 100, noNaN: true }), (rsi) => {
        const result = checkRSICondition(rsi);
        if (rsi >= 30 && rsi <= 70) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
        expect(checkRSICondition(null)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('量能放大检测：近5日均量 > 前5日均量*1.1 时返回 true', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 10000, max: 1000000, noNaN: true }),
        fc.double({ min: 1.0, max: 2.0, noNaN: true }),
        (baseVolume, ratio) => {
          const history: MarketHistoryRow[] = [];
          // Prior 5 days
          for (let i = 0; i < 5; i++) {
            history.push({ trade_date: `2024-01-0${i + 1}`, open_price: 10, close_price: 10, high_price: 11, low_price: 9, volume: baseVolume });
          }
          // Recent 5 days
          for (let i = 0; i < 5; i++) {
            history.push({ trade_date: `2024-01-0${i + 6}`, open_price: 10, close_price: 10, high_price: 11, low_price: 9, volume: baseVolume * ratio });
          }
          const result = checkVolumeExpansion(history);
          if (ratio > 1.1) {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('价格在MA20附近：差值 >= -3% 时返回 true', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 5, max: 200, noNaN: true }),
        fc.double({ min: 5, max: 200, noNaN: true }),
        (close, ma20) => {
          if (ma20 === 0) return;
          const result = checkPriceNearMA20(close, ma20);
          const diff = (close - ma20) / ma20;
          if (diff >= -0.03) {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('属性测试：AI选股结果解析', () => {
  it('parseAIPicksResponse 应返回最多3个不重复周期的结果', () => {
    const candidates: CandidateStock[] = [
      { stockCode: '600000', stockName: '浦发银行', weight: 2, latestClose: 10, indicators: { macdGoldenCross: true, macdNearCross: false, rsiInRange: true, volumeExpanding: true, priceAboveMA20: true }, matchCount: 4 },
      { stockCode: '000001', stockName: '平安银行', weight: 1.5, latestClose: 12, indicators: { macdGoldenCross: true, macdNearCross: false, rsiInRange: true, volumeExpanding: false, priceAboveMA20: true }, matchCount: 3 },
      { stockCode: '300750', stockName: '宁德时代', weight: 3, latestClose: 200, indicators: { macdGoldenCross: false, macdNearCross: true, rsiInRange: true, volumeExpanding: true, priceAboveMA20: true }, matchCount: 3 },
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(
          '[]',
          'invalid json',
          JSON.stringify([{ stockCode: '600000', stockName: '浦发银行', period: 'short', reason: '测试', targetPriceLow: 10.5, targetPriceHigh: 11.0, estimatedUpside: 5 }]),
          JSON.stringify([
            { stockCode: '600000', stockName: '浦发银行', period: 'short', reason: '短期', targetPriceLow: 10.5, targetPriceHigh: 11.0, estimatedUpside: 5 },
            { stockCode: '000001', stockName: '平安银行', period: 'mid', reason: '中期', targetPriceLow: 12.5, targetPriceHigh: 14.0, estimatedUpside: 10 },
            { stockCode: '300750', stockName: '宁德时代', period: 'long', reason: '长期', targetPriceLow: 220, targetPriceHigh: 250, estimatedUpside: 15 },
          ]),
        ),
        (response) => {
          const picks = parseAIPicksResponse(response, candidates);
          expect(picks.length).toBeLessThanOrEqual(3);
          // No duplicate periods
          const periods = picks.map(p => p.period);
          expect(new Set(periods).size).toBe(periods.length);
          // Each pick has required fields
          for (const pick of picks) {
            expect(['short', 'mid', 'long']).toContain(pick.period);
            expect(pick.stockCode).toBeTruthy();
            expect(pick.reason).toBeTruthy();
            expect(pick.targetPriceRange.low).toBeGreaterThan(0);
            expect(pick.targetPriceRange.high).toBeGreaterThan(0);
            expect(pick.estimatedUpside).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 10 }
    );
  });
});
