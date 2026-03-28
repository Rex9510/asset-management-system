/**
 * 市场情绪指数属性测试
 * Task 16.2
 */
import * as fc from 'fast-check';
import { mapVolumeScore, mapChangeScore, calculateSentimentScore, getSentimentLabel } from './sentimentService';

// Feature: ai-investment-assistant-phase2, Property 27: 情绪指数计算与标签映射
// 验证需求：11.1, 11.2
test('情绪指数应在0-100范围内且标签映射正确', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0.01, max: 5, noNaN: true }),  // volumeRatio
      fc.double({ min: -10, max: 10, noNaN: true }),   // shChange
      fc.double({ min: -10, max: 10, noNaN: true }),   // hs300Change
      (volumeRatio, shChange, hs300Change) => {
        const score = calculateSentimentScore(volumeRatio, shChange, hs300Change);

        // Score must be 0-100 integer
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
        expect(Number.isInteger(score)).toBe(true);

        // Label mapping must match score range
        const { label } = getSentimentLabel(score);
        if (score < 25) expect(label).toBe('极度恐慌');
        else if (score < 45) expect(label).toBe('恐慌');
        else if (score < 55) expect(label).toBe('中性');
        else if (score < 75) expect(label).toBe('贪婪');
        else expect(label).toBe('极度贪婪');
      }
    ),
    { numRuns: 100 }
  );
});

// Additional: mapVolumeScore boundaries
test('mapVolumeScore 边界值正确', () => {
  expect(mapVolumeScore(0.3)).toBe(0);
  expect(mapVolumeScore(0.5)).toBe(0);
  expect(mapVolumeScore(1.0)).toBeCloseTo(25, 1);
  expect(mapVolumeScore(1.5)).toBeCloseTo(50, 1);
  expect(mapVolumeScore(3.5)).toBe(100);
});

// Additional: mapChangeScore boundaries
test('mapChangeScore 边界值正确', () => {
  expect(mapChangeScore(-5)).toBe(0);
  expect(mapChangeScore(-3)).toBe(0);
  expect(mapChangeScore(0)).toBeCloseTo(50, 1);
  expect(mapChangeScore(3)).toBe(100);
  expect(mapChangeScore(5)).toBe(100);
});
