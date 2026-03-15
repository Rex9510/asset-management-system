import {
  getConfidenceLabel,
  detectLargeBearishCandle,
  crossValidateConfidence,
  ConfidenceLabel,
} from './confidenceService';
import { AnalysisResult } from '../ai/aiProvider';
import { IndicatorData, MarketHistoryRow } from '../indicators/indicatorService';
import { RiskAlert } from '../indicators/riskDetectionService';

// --- Helpers ---

function makeRow(overrides: Partial<MarketHistoryRow> & { trade_date: string }): MarketHistoryRow {
  return {
    open_price: 10,
    close_price: 10,
    high_price: 10.5,
    low_price: 9.5,
    volume: 1000000,
    ...overrides,
  };
}

function makeAnalysisResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    stage: 'rising',
    spaceEstimate: '10%-15%',
    keySignals: ['MACD金叉'],
    actionRef: 'hold',
    batchPlan: [],
    confidence: 75,
    reasoning: '基于技术指标分析',
    ...overrides,
  };
}

function makeIndicators(overrides: Partial<IndicatorData> = {}): IndicatorData {
  return {
    stockCode: '600000',
    tradeDate: '2024-01-01',
    ma: { ma5: 10, ma10: 10, ma20: 10, ma60: 10 },
    macd: { dif: 0.1, dea: 0.05, histogram: 0.1 },
    kdj: { k: 50, d: 50, j: 50 },
    rsi: { rsi6: 50, rsi12: 50, rsi24: 50 },
    signals: {
      ma: { direction: 'neutral', label: '均线中性' },
      macd: { direction: 'neutral', label: 'MACD中性' },
      kdj: { direction: 'neutral', label: 'KDJ中性' },
      rsi: { direction: 'neutral', label: 'RSI中性' },
    },
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// --- getConfidenceLabel ---

describe('getConfidenceLabel', () => {
  it('should return 🟢高置信 for confidence 80-100', () => {
    expect(getConfidenceLabel(80)).toEqual({ emoji: '🟢', label: '高置信', level: 'high' });
    expect(getConfidenceLabel(90)).toEqual({ emoji: '🟢', label: '高置信', level: 'high' });
    expect(getConfidenceLabel(100)).toEqual({ emoji: '🟢', label: '高置信', level: 'high' });
  });

  it('should return 🟡中置信 for confidence 60-79', () => {
    expect(getConfidenceLabel(60)).toEqual({ emoji: '🟡', label: '中置信', level: 'medium' });
    expect(getConfidenceLabel(70)).toEqual({ emoji: '🟡', label: '中置信', level: 'medium' });
    expect(getConfidenceLabel(79)).toEqual({ emoji: '🟡', label: '中置信', level: 'medium' });
  });

  it('should return 🔴低置信 for confidence 0-59', () => {
    expect(getConfidenceLabel(0)).toEqual({ emoji: '🔴', label: '低置信', level: 'low' });
    expect(getConfidenceLabel(30)).toEqual({ emoji: '🔴', label: '低置信', level: 'low' });
    expect(getConfidenceLabel(59)).toEqual({ emoji: '🔴', label: '低置信', level: 'low' });
  });

  it('should clamp values outside 0-100', () => {
    expect(getConfidenceLabel(-10)).toEqual({ emoji: '🔴', label: '低置信', level: 'low' });
    expect(getConfidenceLabel(150)).toEqual({ emoji: '🟢', label: '高置信', level: 'high' });
  });

  it('should handle boundary at 80 correctly', () => {
    expect(getConfidenceLabel(79.5)).toEqual({ emoji: '🟢', label: '高置信', level: 'high' }); // rounds to 80
    expect(getConfidenceLabel(79.4)).toEqual({ emoji: '🟡', label: '中置信', level: 'medium' }); // rounds to 79
  });

  it('should handle boundary at 60 correctly', () => {
    expect(getConfidenceLabel(59.5)).toEqual({ emoji: '🟡', label: '中置信', level: 'medium' }); // rounds to 60
    expect(getConfidenceLabel(59.4)).toEqual({ emoji: '🔴', label: '低置信', level: 'low' }); // rounds to 59
  });
});

// --- detectLargeBearishCandle ---

describe('detectLargeBearishCandle', () => {
  it('should return false with insufficient data (<6 rows)', () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      makeRow({ trade_date: `2024-01-0${i + 1}` })
    );
    expect(detectLargeBearishCandle(history)).toBe(false);
  });

  it('should detect large bearish candle with high volume', () => {
    const prev5 = Array.from({ length: 5 }, (_, i) =>
      makeRow({ trade_date: `2024-01-0${i + 1}`, volume: 1000000 })
    );
    // close < open by >3%, volume > 1.5x avg
    const latest = makeRow({
      trade_date: '2024-01-06',
      open_price: 10,
      close_price: 9.5, // -5% drop
      volume: 1600000, // 1.6x avg
    });
    expect(detectLargeBearishCandle([...prev5, latest])).toBe(true);
  });

  it('should return false when drop is <=3%', () => {
    const prev5 = Array.from({ length: 5 }, (_, i) =>
      makeRow({ trade_date: `2024-01-0${i + 1}`, volume: 1000000 })
    );
    const latest = makeRow({
      trade_date: '2024-01-06',
      open_price: 10,
      close_price: 9.75, // -2.5% drop, not enough
      volume: 1600000,
    });
    expect(detectLargeBearishCandle([...prev5, latest])).toBe(false);
  });

  it('should return false when volume is not high enough', () => {
    const prev5 = Array.from({ length: 5 }, (_, i) =>
      makeRow({ trade_date: `2024-01-0${i + 1}`, volume: 1000000 })
    );
    const latest = makeRow({
      trade_date: '2024-01-06',
      open_price: 10,
      close_price: 9.5, // -5% drop
      volume: 1400000, // 1.4x avg, not enough
    });
    expect(detectLargeBearishCandle([...prev5, latest])).toBe(false);
  });

  it('should return false when price goes up (not bearish)', () => {
    const prev5 = Array.from({ length: 5 }, (_, i) =>
      makeRow({ trade_date: `2024-01-0${i + 1}`, volume: 1000000 })
    );
    const latest = makeRow({
      trade_date: '2024-01-06',
      open_price: 10,
      close_price: 10.5, // price up
      volume: 1600000,
    });
    expect(detectLargeBearishCandle([...prev5, latest])).toBe(false);
  });
});

// --- crossValidateConfidence ---

describe('crossValidateConfidence', () => {
  const emptyHistory: MarketHistoryRow[] = [];

  it('should not adjust confidence when no contradictions exist', () => {
    const result = makeAnalysisResult({ confidence: 75 });
    const indicators = makeIndicators(); // all neutral
    const riskAlerts: RiskAlert[] = [];

    const cv = crossValidateConfidence(result, indicators, riskAlerts, emptyHistory);
    expect(cv.adjustedConfidence).toBe(75);
    expect(cv.warnings).toHaveLength(0);
  });

  it('should reduce confidence by 15 when technical and AI directions conflict', () => {
    // AI says bullish (rising stage, hold)
    const result = makeAnalysisResult({ stage: 'rising', actionRef: 'add', confidence: 80 });
    // Technical says bearish (3+ bearish signals)
    const indicators = makeIndicators({
      signals: {
        ma: { direction: 'bearish', label: '看空' },
        macd: { direction: 'bearish', label: '看空' },
        kdj: { direction: 'bearish', label: '看空' },
        rsi: { direction: 'neutral', label: '中性' },
      },
    });

    const cv = crossValidateConfidence(result, indicators, [], emptyHistory);
    expect(cv.adjustedConfidence).toBe(65); // 80 - 15
    expect(cv.warnings).toContain('技术形态可能存在主力诱导风险');
  });

  it('should reduce confidence by 10 when volume_divergence risk alert exists', () => {
    const result = makeAnalysisResult({ confidence: 70 });
    const riskAlerts: RiskAlert[] = [
      { type: 'volume_divergence', level: 'warning', label: '量价背离', description: '...' },
    ];

    const cv = crossValidateConfidence(result, null, riskAlerts, emptyHistory);
    expect(cv.adjustedConfidence).toBe(60); // 70 - 10
    expect(cv.warnings).toContain('技术形态可能存在主力诱导风险');
  });

  it('should reduce confidence by 10 when false_breakout risk alert exists', () => {
    const result = makeAnalysisResult({ confidence: 70 });
    const riskAlerts: RiskAlert[] = [
      { type: 'false_breakout', level: 'danger', label: '假突破', description: '...' },
    ];

    const cv = crossValidateConfidence(result, null, riskAlerts, emptyHistory);
    expect(cv.adjustedConfidence).toBe(60);
  });

  it('should add "不宜加仓" warning when large bearish candle detected', () => {
    const result = makeAnalysisResult({ confidence: 70 });
    const prev5 = Array.from({ length: 5 }, (_, i) =>
      makeRow({ trade_date: `2024-01-0${i + 1}`, volume: 1000000 })
    );
    const latest = makeRow({
      trade_date: '2024-01-06',
      open_price: 10,
      close_price: 9.5, // -5%
      volume: 1600000, // 1.6x avg
    });
    const history = [...prev5, latest];

    const cv = crossValidateConfidence(result, null, [], history);
    expect(cv.warnings).toContain('不宜加仓');
  });

  it('should combine multiple adjustments', () => {
    // AI bullish, tech bearish → -15
    // volume_divergence alert → -10
    // large bearish candle → "不宜加仓"
    const result = makeAnalysisResult({ stage: 'rising', actionRef: 'add', confidence: 85 });
    const indicators = makeIndicators({
      signals: {
        ma: { direction: 'bearish', label: '看空' },
        macd: { direction: 'bearish', label: '看空' },
        kdj: { direction: 'bearish', label: '看空' },
        rsi: { direction: 'bearish', label: '看空' },
      },
    });
    const riskAlerts: RiskAlert[] = [
      { type: 'volume_divergence', level: 'danger', label: '量价背离', description: '...' },
    ];
    const prev5 = Array.from({ length: 5 }, (_, i) =>
      makeRow({ trade_date: `2024-01-0${i + 1}`, volume: 1000000 })
    );
    const latest = makeRow({
      trade_date: '2024-01-06',
      open_price: 10,
      close_price: 9.5,
      volume: 1600000,
    });

    const cv = crossValidateConfidence(result, indicators, riskAlerts, [...prev5, latest]);
    expect(cv.adjustedConfidence).toBe(60); // 85 - 15 - 10
    expect(cv.warnings).toContain('技术形态可能存在主力诱导风险');
    expect(cv.warnings).toContain('不宜加仓');
  });

  it('should clamp confidence to 0 minimum', () => {
    const result = makeAnalysisResult({ stage: 'rising', actionRef: 'add', confidence: 10 });
    const indicators = makeIndicators({
      signals: {
        ma: { direction: 'bearish', label: '看空' },
        macd: { direction: 'bearish', label: '看空' },
        kdj: { direction: 'bearish', label: '看空' },
        rsi: { direction: 'bearish', label: '看空' },
      },
    });
    const riskAlerts: RiskAlert[] = [
      { type: 'volume_divergence', level: 'danger', label: '量价背离', description: '...' },
    ];

    const cv = crossValidateConfidence(result, indicators, riskAlerts, emptyHistory);
    expect(cv.adjustedConfidence).toBe(0); // 10 - 15 - 10 = -15 → clamped to 0
  });

  it('should return correct confidence label after adjustment', () => {
    const result = makeAnalysisResult({ confidence: 85 });
    const riskAlerts: RiskAlert[] = [
      { type: 'volume_divergence', level: 'warning', label: '量价背离', description: '...' },
    ];

    const cv = crossValidateConfidence(result, null, riskAlerts, emptyHistory);
    expect(cv.adjustedConfidence).toBe(75); // 85 - 10
    expect(cv.confidenceLabel.emoji).toBe('🟡');
    expect(cv.confidenceLabel.label).toBe('中置信');
    expect(cv.confidenceLabel.level).toBe('medium');
  });

  it('should not add duplicate risk warnings', () => {
    // Both direction conflict and risk alert → only one "主力诱导风险" warning
    const result = makeAnalysisResult({ stage: 'rising', actionRef: 'add', confidence: 80 });
    const indicators = makeIndicators({
      signals: {
        ma: { direction: 'bearish', label: '看空' },
        macd: { direction: 'bearish', label: '看空' },
        kdj: { direction: 'bearish', label: '看空' },
        rsi: { direction: 'neutral', label: '中性' },
      },
    });
    const riskAlerts: RiskAlert[] = [
      { type: 'volume_divergence', level: 'warning', label: '量价背离', description: '...' },
    ];

    const cv = crossValidateConfidence(result, indicators, riskAlerts, emptyHistory);
    const riskWarnings = cv.warnings.filter(w => w === '技术形态可能存在主力诱导风险');
    expect(riskWarnings).toHaveLength(1);
  });

  it('should handle null indicators gracefully', () => {
    const result = makeAnalysisResult({ confidence: 75 });
    const cv = crossValidateConfidence(result, null, [], emptyHistory);
    expect(cv.adjustedConfidence).toBe(75);
    expect(cv.warnings).toHaveLength(0);
  });

  it('should not reduce confidence for late_session_anomaly alone', () => {
    const result = makeAnalysisResult({ confidence: 75 });
    const riskAlerts: RiskAlert[] = [
      { type: 'late_session_anomaly', level: 'warning', label: '尾盘异动', description: '...' },
    ];

    const cv = crossValidateConfidence(result, null, riskAlerts, emptyHistory);
    expect(cv.adjustedConfidence).toBe(75); // no reduction for late_session_anomaly
  });
});
