/**
 * 回本预估与收益预估服务
 *
 * 亏损持仓：基于技术指标趋势和历史波动率预估回本时间范围
 * 盈利持仓：基于技术面和基本面预估持仓收益区间
 * 所有输出使用"参考预估"合规措辞，附带置信度和风险提示
 *
 * 需求：15.2, 15.3, 15.4, 15.5
 */

import { IndicatorData, MarketHistoryRow, SignalDirection } from '../indicators/indicatorService';

// --- Types ---

export interface RecoveryEstimate {
  estimatedDays: [number, number];
  confidence: number;
  note: string;
}

export interface ProfitEstimate {
  profitRange: [number, number];
  targetPriceRange: [number, number];
  confidence: number;
  note: string;
}

// --- Constants ---

const RISK_DISCLAIMER = '仅供参考，实际走势受多种因素影响';

// --- Helpers ---

/**
 * Calculate daily returns from close prices.
 */
export function calculateDailyReturns(history: MarketHistoryRow[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].close_price;
    if (prev > 0) {
      returns.push((history[i].close_price - prev) / prev);
    }
  }
  return returns;
}

/**
 * Calculate annualized historical volatility (standard deviation of daily returns).
 */
export function calculateVolatility(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  return Math.sqrt(variance);
}

/**
 * Count bullish signals from indicator data.
 */
export function countBullishSignals(indicators: IndicatorData | null): number {
  if (!indicators) return 0;
  const directions: SignalDirection[] = [
    indicators.signals.ma.direction,
    indicators.signals.macd.direction,
    indicators.signals.kdj.direction,
    indicators.signals.rsi.direction,
  ];
  return directions.filter(d => d === 'bullish').length;
}

/**
 * Count bearish signals from indicator data.
 */
export function countBearishSignals(indicators: IndicatorData | null): number {
  if (!indicators) return 0;
  const directions: SignalDirection[] = [
    indicators.signals.ma.direction,
    indicators.signals.macd.direction,
    indicators.signals.kdj.direction,
    indicators.signals.rsi.direction,
  ];
  return directions.filter(d => d === 'bearish').length;
}


// --- Core functions ---

/**
 * Estimate recovery time for a losing position.
 *
 * Logic:
 * - Calculate loss percentage
 * - Estimate average daily recovery rate from historical volatility
 * - Factor in technical trend: bullish signals → faster recovery, bearish → slower
 * - Return estimated days range with confidence and compliance note
 */
export function estimateRecovery(
  costPrice: number,
  currentPrice: number,
  indicators: IndicatorData | null,
  history: MarketHistoryRow[]
): RecoveryEstimate {
  // Calculate loss percentage
  const lossPercent = ((costPrice - currentPrice) / costPrice) * 100;

  // Calculate historical volatility
  const dailyReturns = calculateDailyReturns(history);
  const volatility = calculateVolatility(dailyReturns);

  // Base daily recovery rate: use mean positive return as baseline
  const positiveReturns = dailyReturns.filter(r => r > 0);
  const meanPositiveReturn = positiveReturns.length > 0
    ? positiveReturns.reduce((s, r) => s + r, 0) / positiveReturns.length
    : 0.005; // default 0.5% if no data

  // Adjust recovery rate based on technical trend
  const bullishCount = countBullishSignals(indicators);
  const bearishCount = countBearishSignals(indicators);

  let trendMultiplier = 1.0;
  if (bullishCount >= 3) {
    trendMultiplier = 1.5; // Strong bullish → faster recovery
  } else if (bullishCount >= 2) {
    trendMultiplier = 1.2;
  } else if (bearishCount >= 3) {
    trendMultiplier = 0.5; // Strong bearish → slower recovery
  } else if (bearishCount >= 2) {
    trendMultiplier = 0.7;
  }

  const adjustedDailyRate = meanPositiveReturn * trendMultiplier;

  // Estimate days to recover: lossPercent / (adjustedDailyRate * 100)
  // Use optimistic and pessimistic bounds
  let baseDays: number;
  if (adjustedDailyRate > 0) {
    baseDays = lossPercent / (adjustedDailyRate * 100);
  } else {
    baseDays = 120; // fallback: ~4 months
  }

  // Add volatility-based uncertainty range
  const volatilityFactor = volatility > 0 ? Math.max(0.3, Math.min(2.0, volatility * 20)) : 1.0;
  const minDays = Math.max(5, Math.round(baseDays / volatilityFactor));
  const maxDays = Math.max(minDays + 7, Math.round(baseDays * volatilityFactor));

  // Confidence based on data quality and trend clarity
  let confidence = 50;
  if (history.length >= 60) confidence += 15;
  else if (history.length >= 30) confidence += 8;
  if (bullishCount >= 3 || bearishCount >= 3) confidence += 10; // clear trend
  if (volatility > 0 && volatility < 0.05) confidence += 5; // low volatility = more predictable

  confidence = Math.min(75, Math.max(20, confidence)); // cap at 75 for estimates

  // Format note with compliance wording
  const weeksMin = Math.ceil(minDays / 7);
  const weeksMax = Math.ceil(maxDays / 7);
  let timeRange: string;
  if (weeksMax <= 4) {
    timeRange = `${weeksMin}-${weeksMax}周`;
  } else {
    const monthsMin = Math.max(1, Math.round(minDays / 30));
    const monthsMax = Math.max(monthsMin, Math.round(maxDays / 30));
    timeRange = monthsMin === monthsMax ? `约${monthsMin}个月` : `${monthsMin}-${monthsMax}个月`;
  }

  const note = `参考预估：预计${timeRange}可能回本（${RISK_DISCLAIMER}）`;

  return {
    estimatedDays: [minDays, maxDays],
    confidence,
    note,
  };
}

/**
 * Estimate profit range for a profitable position.
 *
 * Logic:
 * - Calculate current profit percentage
 * - Estimate future profit range based on volatility and technical resistance
 * - Factor in technical trend for direction bias
 * - Return profit range with confidence and compliance note
 */
export function estimateProfit(
  costPrice: number,
  currentPrice: number,
  indicators: IndicatorData | null,
  history: MarketHistoryRow[]
): ProfitEstimate {
  // Current profit
  const currentProfitPercent = ((currentPrice - costPrice) / costPrice) * 100;

  // Calculate historical volatility
  const dailyReturns = calculateDailyReturns(history);
  const volatility = calculateVolatility(dailyReturns);

  // Estimate 30-day price range based on volatility
  const dailyVol = volatility > 0 ? volatility : 0.02; // default 2%
  const thirtyDayVol = dailyVol * Math.sqrt(30);

  // Technical trend adjustment
  const bullishCount = countBullishSignals(indicators);
  const bearishCount = countBearishSignals(indicators);

  let upBias = 0;
  if (bullishCount >= 3) upBias = 0.03;
  else if (bullishCount >= 2) upBias = 0.015;
  else if (bearishCount >= 3) upBias = -0.03;
  else if (bearishCount >= 2) upBias = -0.015;

  // Profit range: current profit +/- volatility-based range, adjusted by trend
  const minProfitPercent = Math.max(0, currentProfitPercent - thirtyDayVol * 100 + upBias * 100);
  const maxProfitPercent = currentProfitPercent + thirtyDayVol * 100 + upBias * 100;

  // Target price range
  const minTargetPrice = parseFloat((costPrice * (1 + minProfitPercent / 100)).toFixed(2));
  const maxTargetPrice = parseFloat((costPrice * (1 + maxProfitPercent / 100)).toFixed(2));

  // Confidence
  let confidence = 50;
  if (history.length >= 60) confidence += 15;
  else if (history.length >= 30) confidence += 8;
  if (bullishCount >= 3 || bearishCount >= 3) confidence += 10;
  if (volatility > 0 && volatility < 0.05) confidence += 5;

  confidence = Math.min(75, Math.max(20, confidence));

  const note = `参考预估：按当前趋势，持有30天预计收益区间${minProfitPercent.toFixed(1)}%-${maxProfitPercent.toFixed(1)}%（${RISK_DISCLAIMER}）`;

  return {
    profitRange: [parseFloat(minProfitPercent.toFixed(2)), parseFloat(maxProfitPercent.toFixed(2))],
    targetPriceRange: [minTargetPrice, maxTargetPrice],
    confidence,
    note,
  };
}
