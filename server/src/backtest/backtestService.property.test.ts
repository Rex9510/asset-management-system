/**
 * 持仓回测属性测试
 * Tasks 15.2, 15.3, 15.4
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import {
  percentileRank, median, computePeriodStats,
  findMatchingPoints, computeForwardReturns,
  runBacktest, DISCLAIMER, PERCENTILE_TOLERANCE, MIN_SAMPLE_SIZE
} from './backtestService';
import { initializeDatabase } from '../db/init';

// Feature: ai-investment-assistant-phase2, Property 15: 回测历史匹配点筛选正确性
// 验证需求：7.1
test('所有匹配时点的估值分位在当前分位±5%范围内', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 5, max: 95, noNaN: true }),  // currentPercentile
      fc.array(
        fc.record({
          index: fc.nat({ max: 500 }),
          tradeDate: fc.constant('2024-01-01'),
          percentile: fc.double({ min: 0, max: 100, noNaN: true }),
        }),
        { minLength: 5, maxLength: 50 }
      ),
      (currentPercentile, historicalPercentiles) => {
        const matches = findMatchingPoints(historicalPercentiles, currentPercentile);
        for (const m of matches) {
          expect(m.percentile).toBeGreaterThanOrEqual(currentPercentile - PERCENTILE_TOLERANCE);
          expect(m.percentile).toBeLessThanOrEqual(currentPercentile + PERCENTILE_TOLERANCE);
        }
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: ai-investment-assistant-phase2, Property 16: 回测统计摘要正确性
// 验证需求：7.2, 7.3
test('统计摘要中盈利概率/平均/最大/最小/中位数正确', () => {
  fc.assert(
    fc.property(
      fc.array(fc.double({ min: -0.5, max: 1.0, noNaN: true }), { minLength: 1, maxLength: 50 }),
      (returns) => {
        const stats = computePeriodStats(returns);

        // winRate = positive count / total
        const wins = returns.filter(r => r > 0).length;
        const expectedWinRate = Math.round((wins / returns.length) * 10000) / 10000;
        expect(stats.winRate).toBeCloseTo(expectedWinRate, 4);

        // avgReturn = arithmetic mean
        const sum = returns.reduce((a, b) => a + b, 0);
        const expectedAvg = Math.round((sum / returns.length) * 10000) / 10000;
        expect(stats.avgReturn).toBeCloseTo(expectedAvg, 4);

        // maxReturn = max value
        const expectedMax = Math.round(Math.max(...returns) * 10000) / 10000;
        expect(stats.maxReturn).toBeCloseTo(expectedMax, 4);

        // maxLoss = min value
        const expectedMin = Math.round(Math.min(...returns) * 10000) / 10000;
        expect(stats.maxLoss).toBeCloseTo(expectedMin, 4);

        // medianReturn = sorted middle value
        const expectedMedian = Math.round(median(returns) * 10000) / 10000;
        expect(stats.medianReturn).toBeCloseTo(expectedMedian, 4);
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: ai-investment-assistant-phase2, Property 17: 回测结果风险提示
// 验证需求：7.5, 7.6
test('disclaimer 非空，匹配点<5时 sampleWarning=true', () => {
  const db = new Database(':memory:');
  initializeDatabase(db);

  // No valuation_cache → no matching points → sampleWarning=true
  const result = runBacktest('600000', db);
  expect(result.disclaimer).toBe(DISCLAIMER);
  expect(result.disclaimer.length).toBeGreaterThan(0);
  expect(result.sampleWarning).toBe(true);

  // With valuation_cache but no market_history → still sampleWarning
  db.prepare(
    "INSERT INTO valuation_cache (stock_code, pe_value, pb_value, pe_percentile, pb_percentile, pe_zone, pb_zone, data_years, source) VALUES ('600000', 15, 2, 50, 40, 'fair', 'fair', 5, 'tencent')"
  ).run();
  const result2 = runBacktest('600000', db);
  expect(result2.disclaimer).toBe(DISCLAIMER);
  expect(result2.sampleWarning).toBe(true);

  db.close();
});

// Additional: median function correctness
test('median 计算正确', () => {
  expect(median([1, 2, 3])).toBe(2);
  expect(median([1, 2, 3, 4])).toBe(2.5);
  expect(median([5])).toBe(5);
  expect(median([])).toBe(0);
});

// Additional: computeForwardReturns correctness
test('computeForwardReturns 收益率计算正确', () => {
  const prices = [
    { closePrice: 10 },
    { closePrice: 11 },
    { closePrice: 12 },
    { closePrice: 9 },
    { closePrice: 15 },
  ];
  const matchingPoints = [{ index: 0 }, { index: 1 }];
  const returns = computeForwardReturns(matchingPoints, prices, 2);
  // index 0 → hold 2 days → price 12, return = (12-10)/10 = 0.2
  // index 1 → hold 2 days → price 9, return = (9-11)/11 ≈ -0.1818
  expect(returns).toHaveLength(2);
  expect(returns[0]).toBeCloseTo(0.2, 4);
  expect(returns[1]).toBeCloseTo(-2 / 11, 4);
});
