import { AnalysisResult } from '../ai/aiProvider';
import { IndicatorData, SignalDirection } from '../indicators/indicatorService';
import { RiskAlert } from '../indicators/riskDetectionService';
import { MarketHistoryRow } from '../indicators/indicatorService';

// --- Types ---

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ConfidenceLabel {
  emoji: '🟢' | '🟡' | '🔴';
  label: '高置信' | '中置信' | '低置信';
  level: ConfidenceLevel;
}

export interface CrossValidationResult {
  adjustedConfidence: number;
  confidenceLabel: ConfidenceLabel;
  warnings: string[];
}

// --- Confidence label ---

/**
 * Map a confidence score (0-100) to a label with emoji.
 * 80-100 → 🟢高置信, 60-79 → 🟡中置信, 0-59 → 🔴低置信
 */
export function getConfidenceLabel(confidence: number): ConfidenceLabel {
  const clamped = Math.max(0, Math.min(100, Math.round(confidence)));
  if (clamped >= 80) {
    return { emoji: '🟢', label: '高置信', level: 'high' };
  }
  if (clamped >= 60) {
    return { emoji: '🟡', label: '中置信', level: 'medium' };
  }
  return { emoji: '🔴', label: '低置信', level: 'low' };
}

// --- Large bearish candle detection ---

/**
 * Detect if the latest day is a large bearish candle with high volume.
 * Bearish: close < open by >3%
 * High volume: volume > 1.5x the 5-day average volume
 */
export function detectLargeBearishCandle(history: MarketHistoryRow[]): boolean {
  if (history.length < 6) return false;

  const latest = history[history.length - 1];
  const prev5 = history.slice(-6, -1);

  // Check bearish: close < open by >3%
  const dropPercent = ((latest.open_price - latest.close_price) / latest.open_price) * 100;
  if (dropPercent <= 3) return false;

  // Check high volume: > 1.5x 5-day average
  const avgVolume = prev5.reduce((sum, r) => sum + r.volume, 0) / prev5.length;
  if (avgVolume === 0) return false;

  return latest.volume > avgVolume * 1.5;
}

// --- Determine AI analysis direction ---

function getAnalysisDirection(result: AnalysisResult): 'bullish' | 'bearish' | 'neutral' {
  if (result.actionRef === 'add') return 'bullish';
  if (result.actionRef === 'clear' || result.actionRef === 'reduce') return 'bearish';
  // 'hold' with rising/main_wave stage is bullish-leaning
  if (result.stage === 'rising' || result.stage === 'main_wave' || result.stage === 'bottom') {
    return 'bullish';
  }
  if (result.stage === 'falling' || result.stage === 'high') {
    return 'bearish';
  }
  return 'neutral';
}

// --- Determine technical consensus direction ---

function getTechnicalConsensus(indicators: IndicatorData | null): SignalDirection {
  if (!indicators) return 'neutral';

  const directions = [
    indicators.signals.ma.direction,
    indicators.signals.macd.direction,
    indicators.signals.kdj.direction,
    indicators.signals.rsi.direction,
  ];

  const bullishCount = directions.filter(d => d === 'bullish').length;
  const bearishCount = directions.filter(d => d === 'bearish').length;

  if (bullishCount >= 3) return 'bullish';
  if (bearishCount >= 3) return 'bearish';
  return 'neutral';
}

// --- Cross-validation ---

/**
 * Cross-validate AI analysis result against technical indicators and risk alerts.
 * Adjusts confidence and adds warnings when contradictions are found.
 */
export function crossValidateConfidence(
  analysisResult: AnalysisResult,
  indicators: IndicatorData | null,
  riskAlerts: RiskAlert[],
  history: MarketHistoryRow[]
): CrossValidationResult {
  let adjustedConfidence = analysisResult.confidence;
  const warnings: string[] = [];

  // 1. Cross-validate technical signals vs AI analysis direction
  const aiDirection = getAnalysisDirection(analysisResult);
  const techDirection = getTechnicalConsensus(indicators);

  if (
    aiDirection !== 'neutral' &&
    techDirection !== 'neutral' &&
    aiDirection !== techDirection
  ) {
    // Technical and AI directions conflict → reduce confidence by 15
    adjustedConfidence -= 15;
    warnings.push('技术形态可能存在主力诱导风险');
  }

  // 2. Risk alerts (volume_divergence, false_breakout) → reduce confidence by 10
  const suspiciousAlerts = riskAlerts.filter(
    a => a.type === 'volume_divergence' || a.type === 'false_breakout'
  );
  if (suspiciousAlerts.length > 0) {
    adjustedConfidence -= 10;
    if (!warnings.includes('技术形态可能存在主力诱导风险')) {
      warnings.push('技术形态可能存在主力诱导风险');
    }
  }

  // 3. Large bearish candle with high volume → add "不宜加仓" warning
  if (detectLargeBearishCandle(history)) {
    warnings.push('不宜加仓');
  }

  // Clamp confidence to [0, 100]
  adjustedConfidence = Math.max(0, Math.min(100, adjustedConfidence));

  return {
    adjustedConfidence,
    confidenceLabel: getConfidenceLabel(adjustedConfidence),
    warnings,
  };
}
