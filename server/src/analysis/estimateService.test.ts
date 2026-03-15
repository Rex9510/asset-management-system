import {
  estimateRecovery,
  estimateProfit,
  calculateDailyReturns,
  calculateVolatility,
  countBullishSignals,
  countBearishSignals,
  RecoveryEstimate,
  ProfitEstimate,
} from './estimateService';
import { IndicatorData, MarketHistoryRow } from '../indicators/indicatorService';

// --- Test helpers ---

function makeHistory(days: number, basePrice: number = 10, trend: 'up' | 'down' | 'flat' = 'flat'): MarketHistoryRow[] {
  const rows: MarketHistoryRow[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(2024, 0, 1 + i);
    let price = basePrice;
    if (trend === 'up') price = basePrice + i * 0.05;
    else if (trend === 'down') price = basePrice - i * 0.03;
    else price = basePrice + Math.sin(i / 5) * 0.5;

    rows.push({
      trade_date: date.toISOString().split('T')[0],
      open_price: price - 0.1,
      close_price: price,
      high_price: price + 0.2,
      low_price: price - 0.3,
      volume: 100000,
    });
  }
  return rows;
}

function makeIndicators(overrides?: Partial<IndicatorData>): IndicatorData {
  return {
    stockCode: '600000',
    tradeDate: '2024-03-01',
    ma: { ma5: 10, ma10: 10, ma20: 10, ma60: 10 },
    macd: { dif: 0.1, dea: 0.05, histogram: 0.1 },
    kdj: { k: 50, d: 50, j: 50 },
    rsi: { rsi6: 50, rsi12: 50, rsi24: 50 },
    signals: {
      ma: { direction: 'neutral', label: '中性' },
      macd: { direction: 'neutral', label: '中性' },
      kdj: { direction: 'neutral', label: '中性' },
      rsi: { direction: 'neutral', label: '中性' },
    },
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeBullishIndicators(): IndicatorData {
  return makeIndicators({
    signals: {
      ma: { direction: 'bullish', label: '看多' },
      macd: { direction: 'bullish', label: '看多' },
      kdj: { direction: 'bullish', label: '看多' },
      rsi: { direction: 'neutral', label: '中性' },
    },
  });
}

function makeBearishIndicators(): IndicatorData {
  return makeIndicators({
    signals: {
      ma: { direction: 'bearish', label: '看空' },
      macd: { direction: 'bearish', label: '看空' },
      kdj: { direction: 'bearish', label: '看空' },
      rsi: { direction: 'neutral', label: '中性' },
    },
  });
}

// --- Tests ---

describe('estimateService', () => {
  describe('calculateDailyReturns', () => {
    it('should return empty array for single-day history', () => {
      const history = makeHistory(1);
      expect(calculateDailyReturns(history)).toEqual([]);
    });

    it('should calculate correct daily returns', () => {
      const history: MarketHistoryRow[] = [
        { trade_date: '2024-01-01', open_price: 10, close_price: 10, high_price: 10.5, low_price: 9.5, volume: 100 },
        { trade_date: '2024-01-02', open_price: 10, close_price: 11, high_price: 11.5, low_price: 9.5, volume: 100 },
        { trade_date: '2024-01-03', open_price: 11, close_price: 10.5, high_price: 11.5, low_price: 10, volume: 100 },
      ];
      const returns = calculateDailyReturns(history);
      expect(returns).toHaveLength(2);
      expect(returns[0]).toBeCloseTo(0.1, 4); // (11-10)/10
      expect(returns[1]).toBeCloseTo(-0.04545, 4); // (10.5-11)/11
    });
  });

  describe('calculateVolatility', () => {
    it('should return 0 for insufficient data', () => {
      expect(calculateVolatility([])).toBe(0);
      expect(calculateVolatility([0.01])).toBe(0);
    });

    it('should return positive volatility for varying returns', () => {
      const returns = [0.01, -0.02, 0.03, -0.01, 0.02];
      const vol = calculateVolatility(returns);
      expect(vol).toBeGreaterThan(0);
    });

    it('should return 0 for constant returns', () => {
      const returns = [0.01, 0.01, 0.01, 0.01];
      const vol = calculateVolatility(returns);
      expect(vol).toBeCloseTo(0, 10);
    });
  });

  describe('countBullishSignals / countBearishSignals', () => {
    it('should return 0 for null indicators', () => {
      expect(countBullishSignals(null)).toBe(0);
      expect(countBearishSignals(null)).toBe(0);
    });

    it('should count bullish signals correctly', () => {
      const indicators = makeBullishIndicators();
      expect(countBullishSignals(indicators)).toBe(3);
      expect(countBearishSignals(indicators)).toBe(0);
    });

    it('should count bearish signals correctly', () => {
      const indicators = makeBearishIndicators();
      expect(countBearishSignals(indicators)).toBe(3);
      expect(countBullishSignals(indicators)).toBe(0);
    });
  });

  describe('estimateRecovery', () => {
    const history = makeHistory(65, 10, 'flat');

    it('should return valid recovery estimate for losing position', () => {
      const result = estimateRecovery(12, 10, makeIndicators(), history);

      expect(result.estimatedDays).toHaveLength(2);
      expect(result.estimatedDays[0]).toBeGreaterThanOrEqual(5);
      expect(result.estimatedDays[0]).toBeLessThanOrEqual(result.estimatedDays[1]);
      expect(result.confidence).toBeGreaterThanOrEqual(20);
      expect(result.confidence).toBeLessThanOrEqual(75);
    });

    it('should include 参考预估 compliance wording in note', () => {
      const result = estimateRecovery(12, 10, makeIndicators(), history);

      expect(result.note).toContain('参考预估');
      expect(result.note).toContain('仅供参考');
      expect(result.note).not.toContain('保证');
      expect(result.note).not.toContain('承诺');
    });

    it('should estimate faster recovery with bullish indicators', () => {
      const bullish = estimateRecovery(12, 10, makeBullishIndicators(), history);
      const bearish = estimateRecovery(12, 10, makeBearishIndicators(), history);

      // Bullish should have shorter max estimated days
      expect(bullish.estimatedDays[1]).toBeLessThanOrEqual(bearish.estimatedDays[1]);
    });

    it('should handle empty history gracefully', () => {
      const result = estimateRecovery(12, 10, makeIndicators(), []);

      expect(result.estimatedDays).toHaveLength(2);
      expect(result.estimatedDays[0]).toBeGreaterThanOrEqual(5);
      expect(result.confidence).toBeLessThanOrEqual(75);
    });

    it('should handle null indicators gracefully', () => {
      const result = estimateRecovery(12, 10, null, history);

      expect(result.estimatedDays).toHaveLength(2);
      expect(result.note).toContain('参考预估');
    });

    it('should have higher confidence with more history data', () => {
      const shortHistory = makeHistory(20, 10, 'flat');
      const longHistory = makeHistory(65, 10, 'flat');

      const shortResult = estimateRecovery(12, 10, makeIndicators(), shortHistory);
      const longResult = estimateRecovery(12, 10, makeIndicators(), longHistory);

      expect(longResult.confidence).toBeGreaterThanOrEqual(shortResult.confidence);
    });
  });

  describe('estimateProfit', () => {
    const history = makeHistory(65, 10, 'up');

    it('should return valid profit estimate for profitable position', () => {
      const result = estimateProfit(8, 10, makeIndicators(), history);

      expect(result.profitRange).toHaveLength(2);
      expect(result.profitRange[1]).toBeGreaterThanOrEqual(result.profitRange[0]);
      expect(result.targetPriceRange).toHaveLength(2);
      expect(result.targetPriceRange[0]).toBeGreaterThan(0);
      expect(result.targetPriceRange[1]).toBeGreaterThanOrEqual(result.targetPriceRange[0]);
      expect(result.confidence).toBeGreaterThanOrEqual(20);
      expect(result.confidence).toBeLessThanOrEqual(75);
    });

    it('should include 参考预估 compliance wording in note', () => {
      const result = estimateProfit(8, 10, makeIndicators(), history);

      expect(result.note).toContain('参考预估');
      expect(result.note).toContain('仅供参考');
      expect(result.note).not.toContain('保证');
      expect(result.note).not.toContain('承诺');
    });

    it('should show wider profit range with bullish indicators', () => {
      const bullish = estimateProfit(8, 10, makeBullishIndicators(), history);
      const bearish = estimateProfit(8, 10, makeBearishIndicators(), history);

      // Bullish should have higher max profit
      expect(bullish.profitRange[1]).toBeGreaterThan(bearish.profitRange[1]);
    });

    it('should handle empty history gracefully', () => {
      const result = estimateProfit(8, 10, makeIndicators(), []);

      expect(result.profitRange).toHaveLength(2);
      expect(result.note).toContain('参考预估');
    });

    it('should handle null indicators gracefully', () => {
      const result = estimateProfit(8, 10, null, history);

      expect(result.profitRange).toHaveLength(2);
      expect(result.note).toContain('参考预估');
    });

    it('should have min profit range >= 0', () => {
      const result = estimateProfit(9.5, 10, makeIndicators(), history);
      expect(result.profitRange[0]).toBeGreaterThanOrEqual(0);
    });
  });
});
