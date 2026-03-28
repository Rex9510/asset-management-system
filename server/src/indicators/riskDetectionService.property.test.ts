import * as fc from 'fast-check';
import {
  detectVolumeDivergence,
  detectLateSessionAnomaly,
  detectFalseBreakout,
  RiskAlert,
} from './riskDetectionService';
import { MarketHistoryRow } from './indicatorService';

// Arbitrary for market history rows
const historyRowArb = fc.record({
  trade_date: fc.constant('2024-01-01'),
  open_price: fc.double({ min: 5, max: 200, noNaN: true }),
  close_price: fc.double({ min: 5, max: 200, noNaN: true }),
  high_price: fc.double({ min: 5, max: 200, noNaN: true }),
  low_price: fc.double({ min: 1, max: 200, noNaN: true }),
  volume: fc.double({ min: 1000, max: 10000000, noNaN: true }),
}).map(r => ({
  ...r,
  high_price: Math.max(r.open_price, r.close_price, r.high_price),
  low_price: Math.min(r.open_price, r.close_price, r.low_price),
}));

const historySeriesArb = (minLen: number) =>
  fc.array(historyRowArb, { minLength: minLen, maxLength: 30 });

describe('属性测试：可疑形态检测完整性', () => {
  it('量价背离检测：放量不涨时应返回 volume_divergence 或 null', () => {
    fc.assert(
      fc.property(historySeriesArb(6), (history) => {
        const result = detectVolumeDivergence(history);
        if (result !== null) {
          expect(result.type).toBe('volume_divergence');
          expect(['warning', 'danger']).toContain(result.level);
          expect(result.label).toBeTruthy();
          expect(result.description).toBeTruthy();
        }
      }),
      { numRuns: 100 }
    );
  });

  it('尾盘异动检测：返回值类型正确或为 null', () => {
    fc.assert(
      fc.property(historySeriesArb(1), (history) => {
        const result = detectLateSessionAnomaly(history);
        if (result !== null) {
          expect(result.type).toBe('late_session_anomaly');
          expect(['warning', 'danger']).toContain(result.level);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('假突破检测：数据不足22天时应返回 null', () => {
    fc.assert(
      fc.property(
        fc.array(historyRowArb, { minLength: 1, maxLength: 21 }),
        (history) => {
          const result = detectFalseBreakout(history);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('所有检测函数返回值结构一致：type/level/label/description', () => {
    fc.assert(
      fc.property(historySeriesArb(25), (history) => {
        const results: (RiskAlert | null)[] = [
          detectVolumeDivergence(history),
          detectLateSessionAnomaly(history),
          detectFalseBreakout(history),
        ];
        for (const r of results) {
          if (r !== null) {
            expect(r).toHaveProperty('type');
            expect(r).toHaveProperty('level');
            expect(r).toHaveProperty('label');
            expect(r).toHaveProperty('description');
            expect(['volume_divergence', 'late_session_anomaly', 'false_breakout']).toContain(r.type);
          }
        }
      }),
      { numRuns: 50 }
    );
  });
});
