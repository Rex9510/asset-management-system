/**
 * 估值分位属性测试
 * Tasks 5.2, 5.3, 5.4
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { mapPercentileToZone, calculatePercentile, calculateDataYears, fetchPePbWithFallback } from './valuationService';
import { initializeDatabase } from '../db/init';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Feature: ai-investment-assistant-phase2, Property 1: 估值区间映射正确性
// 验证需求：1.4
test('估值区间映射应与百分位数值严格对应', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100 }),
      (percentile) => {
        const zone = mapPercentileToZone(percentile);
        if (percentile < 30) return zone === 'low';
        if (percentile < 70) return zone === 'fair';
        return zone === 'high';
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: ai-investment-assistant-phase2, Property 2: 估值分位数据源降级链
// 验证需求：1.2
test('数据源降级顺序：腾讯→新浪→缓存→AI估算', async () => {
  const db = new Database(':memory:');
  initializeDatabase(db);

  // Seed valuation_cache for fallback
  db.prepare(
    "INSERT INTO valuation_cache (stock_code, pe_value, pb_value, pe_percentile, pb_percentile, pe_zone, pb_zone, data_years, source) VALUES ('600000', 15, 2.5, 30, 40, 'low', 'fair', 10, 'tencent')"
  ).run();

  // Mock both Tencent and Sina failing
  mockedAxios.get.mockRejectedValue(new Error('network error'));

  const result = await fetchPePbWithFallback('600000', db);
  // Should fall back to cache
  expect(result.source).toBe('cache');
  expect(result.pe).toBe(15);

  db.close();
});

// Feature: ai-investment-assistant-phase2, Property 3: 估值分位数据年限标注
// 验证需求：1.3
test('数据不足10年时 dataYears 等于实际年限', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 15 }),
      (years) => {
        // Generate first and last dates spanning exactly 'years' years of calendar time
        const now = new Date();
        const start = new Date(now.getTime() - years * 365.25 * 24 * 60 * 60 * 1000);
        const prices: { tradeDate: string }[] = [
          { tradeDate: start.toISOString().slice(0, 10) },
          { tradeDate: now.toISOString().slice(0, 10) },
        ];
        const result = calculateDataYears(prices);
        // dataYears should be approximately equal to years (±0.5 due to rounding)
        return result >= years - 0.5 && result <= years + 0.5;
      }
    ),
    { numRuns: 20 }
  );
});
