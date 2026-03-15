import { generateBatchPlan, calculateProfitPercent, PositionData, BatchPlanResult } from './batchPlanService';
import { AnalysisResult } from '../ai/aiProvider';

function makePosition(overrides: Partial<PositionData> = {}): PositionData {
  return {
    costPrice: 10,
    shares: 1000,
    buyDate: '2024-01-01',
    ...overrides,
  };
}

function makeAnalysisResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    stage: 'rising',
    spaceEstimate: '上方空间约10%',
    keySignals: ['MACD金叉'],
    actionRef: 'hold',
    batchPlan: [],
    confidence: 75,
    reasoning: '参考方案：技术面向好',
    ...overrides,
  };
}

describe('batchPlanService', () => {
  describe('calculateProfitPercent', () => {
    it('should calculate positive profit correctly', () => {
      expect(calculateProfitPercent(10, 12)).toBeCloseTo(20);
    });

    it('should calculate negative profit correctly', () => {
      expect(calculateProfitPercent(10, 8)).toBeCloseTo(-20);
    });

    it('should return 0 for zero cost price', () => {
      expect(calculateProfitPercent(0, 10)).toBe(0);
    });

    it('should return 0 when price equals cost', () => {
      expect(calculateProfitPercent(10, 10)).toBe(0);
    });
  });

  describe('generateBatchPlan - losing position', () => {
    it('should recommend hold for losing position', () => {
      const pos = makePosition({ costPrice: 12 });
      const result = generateBatchPlan(pos, 10, makeAnalysisResult());

      expect(result.positionStrategy).toBeNull();
      expect(result.batchPlan).toHaveLength(1);
      expect(result.batchPlan[0].note).toContain('参考方案');
      expect(result.batchPlan[0].note).toContain('亏损');
      expect(result.warnings).toHaveLength(0);
    });

    it('should mention confidence when high for losing position', () => {
      const pos = makePosition({ costPrice: 12 });
      const result = generateBatchPlan(pos, 10, makeAnalysisResult({ confidence: 85 }));

      expect(result.batchPlan[0].note).toContain('信心');
    });

    it('should warn against adding when confidence is low', () => {
      const pos = makePosition({ costPrice: 12 });
      const result = generateBatchPlan(pos, 10, makeAnalysisResult({ confidence: 50 }));

      expect(result.batchPlan[0].note).toContain('不宜盲目加仓');
    });
  });

  describe('generateBatchPlan - profitable position (no surge)', () => {
    it('should split into base and profit positions', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      const result = generateBatchPlan(pos, 11, makeAnalysisResult({ stage: 'rising' }));

      expect(result.positionStrategy).not.toBeNull();
      expect(result.positionStrategy!.basePosition.percent).toBe(60);
      expect(result.positionStrategy!.profitPosition.percent).toBe(40);
    });

    it('should use 参考方案 wording in base position action', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      const result = generateBatchPlan(pos, 11, makeAnalysisResult());

      expect(result.positionStrategy!.basePosition.action).toContain('参考方案');
      expect(result.positionStrategy!.basePosition.action).not.toContain('建议');
      expect(result.positionStrategy!.basePosition.action).not.toContain('推荐');
    });

    it('should use 参考方案 wording in profit position action', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      const result = generateBatchPlan(pos, 11, makeAnalysisResult());

      expect(result.positionStrategy!.profitPosition.action).toContain('参考方案');
      expect(result.positionStrategy!.profitPosition.action).not.toContain('建议');
      expect(result.positionStrategy!.profitPosition.action).not.toContain('推荐');
    });

    it('should recommend hold for base position in rising stage', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      const result = generateBatchPlan(pos, 11, makeAnalysisResult({ stage: 'rising' }));

      expect(result.positionStrategy!.basePosition.action).toContain('持有');
    });

    it('should recommend reduction for base position in falling stage', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      const result = generateBatchPlan(pos, 11, makeAnalysisResult({ stage: 'falling' }));

      expect(result.positionStrategy!.basePosition.action).toContain('减持');
    });

    it('should generate batch plan items with 参考方案 wording', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      const result = generateBatchPlan(pos, 11, makeAnalysisResult({ stage: 'rising' }));

      for (const item of result.batchPlan) {
        expect(item.note).toContain('参考方案');
        expect(item.note).not.toContain('建议');
        expect(item.note).not.toContain('推荐');
      }
    });

    it('should not generate surge warning for moderate profit', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      // 5% profit - below 10% threshold
      const result = generateBatchPlan(pos, 10.5, makeAnalysisResult());

      expect(result.warnings).not.toContain('短期涨幅较大，参考分批减仓方案');
    });
  });

  describe('generateBatchPlan - short-term surge >10%', () => {
    it('should generate 3-step reduction plan', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      // 15% profit - above 10% threshold
      const result = generateBatchPlan(pos, 11.5, makeAnalysisResult());

      // Should have multiple batch plan items (up to 3 steps)
      expect(result.batchPlan.length).toBeGreaterThanOrEqual(1);
      expect(result.batchPlan.length).toBeLessThanOrEqual(3);
    });

    it('should add surge warning', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      const result = generateBatchPlan(pos, 11.5, makeAnalysisResult());

      expect(result.warnings).toContain('短期涨幅较大，参考分批减仓方案');
    });

    it('should have all sell actions in surge plan', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      const result = generateBatchPlan(pos, 11.5, makeAnalysisResult());

      for (const item of result.batchPlan) {
        expect(item.action).toBe('sell');
      }
    });

    it('should use 参考方案 wording in all surge plan notes', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      const result = generateBatchPlan(pos, 11.5, makeAnalysisResult());

      for (const item of result.batchPlan) {
        expect(item.note).toContain('参考方案');
        expect(item.note).not.toContain('建议');
        expect(item.note).not.toContain('推荐');
      }
    });

    it('should set increasing target prices in surge plan', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      const currentPrice = 11.5;
      const result = generateBatchPlan(pos, currentPrice, makeAnalysisResult());

      if (result.batchPlan.length >= 2) {
        for (let i = 1; i < result.batchPlan.length; i++) {
          expect(result.batchPlan[i].targetPrice).toBeGreaterThanOrEqual(
            result.batchPlan[i - 1].targetPrice
          );
        }
      }
    });

    it('should distinguish profit position strategy in surge scenario', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      const result = generateBatchPlan(pos, 11.5, makeAnalysisResult());

      expect(result.positionStrategy).not.toBeNull();
      expect(result.positionStrategy!.profitPosition.action).toContain('分批减仓');
    });
  });

  describe('generateBatchPlan - edge cases', () => {
    it('should handle break-even position (0% profit) as losing', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      const result = generateBatchPlan(pos, 10, makeAnalysisResult());

      expect(result.positionStrategy).toBeNull();
    });

    it('should handle small share count', () => {
      const pos = makePosition({ costPrice: 10, shares: 100 });
      const result = generateBatchPlan(pos, 11.5, makeAnalysisResult());

      // Should not crash with small shares
      expect(result).toBeDefined();
      expect(result.positionStrategy).not.toBeNull();
    });

    it('should handle exactly 10% profit as not surge', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      // Exactly 10% - should NOT trigger surge (threshold is >10%)
      const result = generateBatchPlan(pos, 11, makeAnalysisResult());

      expect(result.warnings).not.toContain('短期涨幅较大，参考分批减仓方案');
    });

    it('should handle just above 10% profit as surge', () => {
      const pos = makePosition({ costPrice: 10, shares: 1000 });
      // 10.1% - should trigger surge
      const result = generateBatchPlan(pos, 11.01, makeAnalysisResult());

      expect(result.warnings).toContain('短期涨幅较大，参考分批减仓方案');
    });
  });
});
