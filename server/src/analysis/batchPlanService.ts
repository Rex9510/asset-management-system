/**
 * 分仓滚动操作方案生成服务
 *
 * 对盈利持仓区分利润仓和底仓，分别给出操作参考。
 * 短期涨幅超10%时主动提示分批减仓方案。
 * 所有输出使用"参考方案"合规措辞。
 *
 * 需求：17.1, 17.2, 17.3, 17.5
 */

import { AnalysisResult } from '../ai/aiProvider';

// --- Types ---

export interface PositionData {
  costPrice: number;
  shares: number;
  buyDate: string;
}

export interface BatchPlanItem {
  action: 'buy' | 'sell';
  shares: number;
  targetPrice: number;
  note: string;
}

export interface PositionStrategy {
  profitPosition: { percent: number; action: string };
  basePosition: { percent: number; action: string };
}

export interface BatchPlanResult {
  batchPlan: BatchPlanItem[];
  warnings: string[];
  positionStrategy: PositionStrategy | null;
}

// --- Constants ---

const BASE_POSITION_RATIO = 0.6;
const PROFIT_POSITION_RATIO = 0.4;
const SHORT_TERM_SURGE_THRESHOLD = 10;

// --- Helpers ---

/**
 * Calculate profit/loss percentage: (currentPrice - costPrice) / costPrice * 100
 */
export function calculateProfitPercent(costPrice: number, currentPrice: number): number {
  if (costPrice <= 0) return 0;
  return ((currentPrice - costPrice) / costPrice) * 100;
}

/**
 * Round shares down to nearest lot of 100 (A-share standard lot).
 * Minimum return is 100 if input >= 100, otherwise return input as-is.
 */
function roundToLot(shares: number): number {
  return Math.floor(shares / 100) * 100;
}


// --- Core logic ---

/**
 * Generate a batch plan for a profitable position with short-term surge (>10%).
 * 3-step reduction: 30% at current, 30% at +5%, 40% at +10%.
 */
function generateSurgeReductionPlan(
  profitShares: number,
  currentPrice: number
): BatchPlanItem[] {
  const step1Shares = roundToLot(Math.ceil(profitShares * 0.3));
  const step2Shares = roundToLot(Math.ceil(profitShares * 0.3));
  const step3Shares = profitShares - step1Shares - step2Shares;

  const plan: BatchPlanItem[] = [];

  if (step1Shares > 0) {
    plan.push({
      action: 'sell',
      shares: step1Shares,
      targetPrice: parseFloat(currentPrice.toFixed(2)),
      note: `参考方案：当前价位先出${step1Shares}股锁定部分利润`,
    });
  }

  if (step2Shares > 0) {
    plan.push({
      action: 'sell',
      shares: step2Shares,
      targetPrice: parseFloat((currentPrice * 1.05).toFixed(2)),
      note: `参考方案：涨至${(currentPrice * 1.05).toFixed(2)}元可考虑再出${step2Shares}股`,
    });
  }

  if (step3Shares > 0) {
    plan.push({
      action: 'sell',
      shares: step3Shares,
      targetPrice: parseFloat((currentPrice * 1.10).toFixed(2)),
      note: `参考方案：涨至${(currentPrice * 1.10).toFixed(2)}元可考虑出清剩余利润仓${step3Shares}股`,
    });
  }

  return plan;
}

/**
 * Generate a standard profit-position reduction plan (no surge).
 */
function generateStandardProfitPlan(
  profitShares: number,
  currentPrice: number,
  stage: AnalysisResult['stage']
): BatchPlanItem[] {
  if (profitShares <= 0) return [];

  const plan: BatchPlanItem[] = [];

  if (stage === 'high' || stage === 'falling') {
    // High/falling stage: recommend gradual reduction of profit position
    const sellShares = roundToLot(Math.ceil(profitShares * 0.5));
    if (sellShares > 0) {
      plan.push({
        action: 'sell',
        shares: sellShares,
        targetPrice: parseFloat(currentPrice.toFixed(2)),
        note: `参考方案：当前阶段偏高，可考虑先减${sellShares}股利润仓`,
      });
    }
  } else {
    // Rising/main_wave/bottom: hold profit position, set target for partial reduction
    const targetPrice = parseFloat((currentPrice * 1.08).toFixed(2));
    const sellShares = roundToLot(Math.ceil(profitShares * 0.3));
    if (sellShares > 0) {
      plan.push({
        action: 'sell',
        shares: sellShares,
        targetPrice,
        note: `参考方案：涨至${targetPrice}元可考虑减${sellShares}股利润仓锁定利润`,
      });
    }
  }

  return plan;
}

/**
 * Generate batch plan for a position.
 *
 * - Profitable positions: split into 底仓 (base, ~60%) and 利润仓 (profit, ~40%),
 *   give separate action references.
 * - Short-term gain >10%: generate 3-step reduction plan with warning.
 * - Losing positions: recommend hold, no adding unless confidence is high.
 * - All text uses "参考方案" compliance wording.
 */
export function generateBatchPlan(
  positionData: PositionData,
  currentPrice: number,
  analysisResult: AnalysisResult
): BatchPlanResult {
  const profitPercent = calculateProfitPercent(positionData.costPrice, currentPrice);
  const totalShares = positionData.shares;
  const warnings: string[] = [];

  // --- Losing position ---
  if (profitPercent <= 0) {
    const plan: BatchPlanItem[] = [];
    const note =
      analysisResult.confidence >= 80
        ? '参考方案：当前处于亏损状态，如对后市有信心可继续持有观望'
        : '参考方案：当前处于亏损状态，持有观望为主，不宜盲目加仓';

    plan.push({
      action: 'buy',
      shares: 0,
      targetPrice: parseFloat(currentPrice.toFixed(2)),
      note,
    });

    return { batchPlan: plan, warnings, positionStrategy: null };
  }

  // --- Profitable position: split into base and profit positions ---
  const baseShares = roundToLot(Math.floor(totalShares * BASE_POSITION_RATIO));
  const profitShares = totalShares - baseShares;

  // Determine base position action
  let baseAction: string;
  if (analysisResult.stage === 'falling') {
    baseAction = '参考方案：底仓部分可视情况适当减持，关注支撑位';
  } else {
    baseAction = '参考方案：底仓部分继续持有，长期持仓为主';
  }

  // Determine profit position action
  let profitAction: string;
  let batchPlan: BatchPlanItem[];

  if (profitPercent > SHORT_TERM_SURGE_THRESHOLD) {
    // Short-term surge >10%: generate 3-step reduction plan
    profitAction = '参考方案：利润仓部分短期涨幅较大，可考虑分批减仓锁定利润';
    batchPlan = generateSurgeReductionPlan(profitShares, currentPrice);
    warnings.push('短期涨幅较大，参考分批减仓方案');
  } else {
    profitAction = '参考方案：利润仓部分可灵活操作，适时锁定利润';
    batchPlan = generateStandardProfitPlan(profitShares, currentPrice, analysisResult.stage);
  }

  const positionStrategy: PositionStrategy = {
    basePosition: {
      percent: Math.round((baseShares / totalShares) * 100),
      action: baseAction,
    },
    profitPosition: {
      percent: Math.round((profitShares / totalShares) * 100),
      action: profitAction,
    },
  };

  return { batchPlan, warnings, positionStrategy };
}
