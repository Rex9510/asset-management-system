/**
 * 持仓回测服务
 *
 * 纯规则引擎，零AI调用。
 * 基于历史估值分位数据，找出与当前估值分位相近（±5%）的历史时点，
 * 计算持有30d/90d/180d/365d的收益率，输出统计摘要。
 *
 * 需求：7.1, 7.2, 7.3, 7.5, 7.6
 */
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';

// --- Types ---

export interface BacktestPeriodResult {
  period: '30d' | '90d' | '180d' | '365d';
  winRate: number;
  avgReturn: number;
  maxReturn: number;
  maxLoss: number;
  medianReturn: number;
}

export interface BacktestResult {
  stockCode: string;
  currentPercentile: number;
  matchingPoints: number;
  results: BacktestPeriodResult[];
  sampleWarning: boolean;
  summary: string;
  disclaimer: string;
}

export const DISCLAIMER = '以上内容仅供学习参考，不构成投资依据';
export const HOLDING_PERIODS = [30, 90, 180, 365] as const;
export const PERCENTILE_TOLERANCE = 5;
export const MIN_SAMPLE_SIZE = 5;

// --- Helpers ---

/**
 * 计算百分位排名：小于当前值的数量 / 总数 × 100
 */
export function percentileRank(value: number, sorted: number[]): number {
  if (sorted.length === 0) return 50;
  const below = sorted.filter(v => v < value).length;
  return (below / sorted.length) * 100;
}

/**
 * 计算中位数
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * 计算单个持有期的统计摘要
 */
export function computePeriodStats(returns: number[]): Omit<BacktestPeriodResult, 'period'> {
  if (returns.length === 0) {
    return { winRate: 0, avgReturn: 0, maxReturn: 0, maxLoss: 0, medianReturn: 0 };
  }
  const wins = returns.filter(r => r > 0).length;
  const sum = returns.reduce((a, b) => a + b, 0);
  return {
    winRate: Math.round((wins / returns.length) * 10000) / 10000,
    avgReturn: Math.round((sum / returns.length) * 10000) / 10000,
    maxReturn: Math.round(Math.max(...returns) * 10000) / 10000,
    maxLoss: Math.round(Math.min(...returns) * 10000) / 10000,
    medianReturn: Math.round(median(returns) * 10000) / 10000,
  };
}


/**
 * 根据180天维度的回测数据生成一句话总结
 * 纯规则，零AI调用
 */
export function generateBacktestSummary(results: BacktestPeriodResult[], matchingPoints: number): string {
  if (matchingPoints === 0) {
    return '匹配数据不足，暂无法生成回测总结';
  }

  const r180 = results.find(r => r.period === '180d');
  if (!r180) {
    return '回测数据不完整，暂无法生成总结';
  }

  const winPct = (r180.winRate * 100).toFixed(0);
  const avgPct = (r180.avgReturn * 100).toFixed(1);

  // 判断强弱
  let strength: string;
  if (r180.winRate >= 0.6 && r180.avgReturn > 0.05) {
    strength = '整体偏强';
  } else if (r180.winRate >= 0.5 && r180.avgReturn > 0) {
    strength = '整体中性偏强';
  } else if (r180.winRate >= 0.4 && r180.avgReturn > -0.05) {
    strength = '整体中性偏弱';
  } else {
    strength = '整体偏弱';
  }

  return `历史类似位置买入，半年维度胜率${winPct}%，平均收益${avgPct}%，${strength}`;
}

// --- Core logic ---

/**
 * 获取当前PE分位数（从 valuation_cache 表）
 */
export function getCurrentPercentile(stockCode: string, db: Database.Database): number | null {
  const row = db.prepare(
    'SELECT pe_percentile FROM valuation_cache WHERE stock_code = ?'
  ).get(stockCode) as { pe_percentile: number } | undefined;
  return row?.pe_percentile ?? null;
}

/**
 * 获取历史价格数据（从 market_history 表，按日期升序）
 */
export function getHistoricalPrices(
  stockCode: string,
  db: Database.Database
): { tradeDate: string; closePrice: number }[] {
  const rows = db.prepare(
    'SELECT trade_date, close_price FROM market_history WHERE stock_code = ? ORDER BY trade_date ASC'
  ).all(stockCode) as { trade_date: string; close_price: number }[];
  return rows.map(r => ({ tradeDate: r.trade_date, closePrice: r.close_price }));
}

/**
 * 为每个历史日期计算其在截至该日期的所有价格中的百分位排名。
 * 这是对历史估值分位的近似：用价格在历史范围中的位置作为估值分位的代理。
 *
 * 返回: { index, tradeDate, percentile }[]
 */
export function computeHistoricalPercentiles(
  prices: { tradeDate: string; closePrice: number }[]
): { index: number; tradeDate: string; percentile: number }[] {
  const result: { index: number; tradeDate: string; percentile: number }[] = [];

  for (let i = 0; i < prices.length; i++) {
    // 使用截至当前日期的所有价格计算百分位
    const pricesUpToNow = prices.slice(0, i + 1).map(p => p.closePrice);
    const pct = percentileRank(prices[i].closePrice, pricesUpToNow);
    result.push({ index: i, tradeDate: prices[i].tradeDate, percentile: pct });
  }

  return result;
}

/**
 * 找出估值分位在 currentPercentile ± tolerance 范围内的历史时点
 */
export function findMatchingPoints(
  historicalPercentiles: { index: number; tradeDate: string; percentile: number }[],
  currentPercentile: number,
  tolerance: number = PERCENTILE_TOLERANCE
): { index: number; tradeDate: string; percentile: number }[] {
  const lower = currentPercentile - tolerance;
  const upper = currentPercentile + tolerance;
  return historicalPercentiles.filter(p => p.percentile >= lower && p.percentile <= upper);
}

/**
 * 计算从匹配点开始持有 N 个交易日后的收益率
 * 收益率 = (未来价格 - 当前价格) / 当前价格
 */
export function computeForwardReturns(
  matchingPoints: { index: number }[],
  prices: { closePrice: number }[],
  holdingDays: number
): number[] {
  const returns: number[] = [];
  for (const point of matchingPoints) {
    const futureIndex = point.index + holdingDays;
    if (futureIndex < prices.length) {
      const entryPrice = prices[point.index].closePrice;
      const exitPrice = prices[futureIndex].closePrice;
      if (entryPrice > 0) {
        returns.push((exitPrice - entryPrice) / entryPrice);
      }
    }
  }
  return returns;
}

/**
 * 执行持仓回测
 *
 * 1. 从 valuation_cache 获取当前PE分位
 * 2. 从 market_history 获取历史价格
 * 3. 重建历史百分位序列
 * 4. 找出 ±5% 范围内的匹配点
 * 5. 计算各持有期收益率统计
 */
export function runBacktest(stockCode: string, db?: Database.Database): BacktestResult {
  const database = db || getDatabase();

  // 1. 获取当前PE分位
  const currentPercentile = getCurrentPercentile(stockCode, database);
  if (currentPercentile === null) {
    const emptyResults = HOLDING_PERIODS.map(d => ({
      period: `${d}d` as BacktestPeriodResult['period'],
      winRate: 0,
      avgReturn: 0,
      maxReturn: 0,
      maxLoss: 0,
      medianReturn: 0,
    }));
    return {
      stockCode,
      currentPercentile: 0,
      matchingPoints: 0,
      results: emptyResults,
      sampleWarning: true,
      summary: generateBacktestSummary(emptyResults, 0),
      disclaimer: DISCLAIMER,
    };
  }

  // 2. 获取历史价格
  const prices = getHistoricalPrices(stockCode, database);
  if (prices.length === 0) {
    const emptyResults = HOLDING_PERIODS.map(d => ({
      period: `${d}d` as BacktestPeriodResult['period'],
      winRate: 0,
      avgReturn: 0,
      maxReturn: 0,
      maxLoss: 0,
      medianReturn: 0,
    }));
    return {
      stockCode,
      currentPercentile,
      matchingPoints: 0,
      results: emptyResults,
      sampleWarning: true,
      summary: generateBacktestSummary(emptyResults, 0),
      disclaimer: DISCLAIMER,
    };
  }

  // 3. 重建历史百分位序列
  const historicalPercentiles = computeHistoricalPercentiles(prices);

  // 4. 找出匹配点
  const matchingPts = findMatchingPoints(historicalPercentiles, currentPercentile);

  // 5. 计算各持有期统计
  const results: BacktestPeriodResult[] = HOLDING_PERIODS.map(days => {
    const returns = computeForwardReturns(matchingPts, prices, days);
    const stats = computePeriodStats(returns);
    return {
      period: `${days}d` as BacktestPeriodResult['period'],
      ...stats,
    };
  });

  return {
    stockCode,
    currentPercentile,
    matchingPoints: matchingPts.length,
    results,
    sampleWarning: matchingPts.length < MIN_SAMPLE_SIZE,
    summary: generateBacktestSummary(results, matchingPts.length),
    disclaimer: DISCLAIMER,
  };
}
