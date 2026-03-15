import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { Errors } from '../errors/AppError';
import { isValidStockCode } from '../positions/positionService';
import { getMarketHistory, MarketHistoryRow, calculateMA } from './indicatorService';

// --- Types ---

export interface RiskAlert {
  type: 'volume_divergence' | 'late_session_anomaly' | 'false_breakout';
  level: 'warning' | 'danger';
  label: string;
  description: string;
}

// --- Pure detection functions ---

/**
 * Detect volume-price divergence: volume increases >10% vs 5-day average
 * but price change is <1% or negative.
 */
export function detectVolumeDivergence(history: MarketHistoryRow[]): RiskAlert | null {
  if (history.length < 6) return null;

  const latest = history[history.length - 1];
  const prev5 = history.slice(-6, -1);

  const avgVolume = prev5.reduce((sum, r) => sum + r.volume, 0) / prev5.length;
  if (avgVolume === 0) return null;

  const volumeChangePercent = ((latest.volume - avgVolume) / avgVolume) * 100;
  const priceChangePercent = ((latest.close_price - latest.open_price) / latest.open_price) * 100;

  if (volumeChangePercent > 10 && priceChangePercent < 1) {
    const level = priceChangePercent < 0 ? 'danger' : 'warning';
    return {
      type: 'volume_divergence',
      level,
      label: '⚠️ 量价背离，警惕主力出货',
      description: priceChangePercent < 0
        ? '成交量明显放大但股价下跌，可能是主力在高位出货，散户接盘的信号。这种情况下追涨风险较大。'
        : '成交量明显放大但股价几乎没涨，说明有大量卖盘在压制股价，主力可能在悄悄出货。',
    };
  }

  return null;
}

/**
 * Detect late session anomaly: last 30 minutes price change accounts for >50% of daily change.
 * Since we don't have intraday data, we approximate by comparing close vs a midpoint
 * derived from open/high/low. If the close deviates significantly from the intraday
 * midpoint and the daily range is meaningful, it suggests late session manipulation.
 */
export function detectLateSessionAnomaly(history: MarketHistoryRow[]): RiskAlert | null {
  if (history.length < 1) return null;

  const latest = history[history.length - 1];
  const dailyChange = latest.close_price - latest.open_price;
  const dailyRange = latest.high_price - latest.low_price;

  if (dailyRange === 0) return null;

  // Approximate: the "midpoint" of the day is (open + high + low) / 3
  // The "late session move" is how much close deviates from this midpoint
  const intradayMidpoint = (latest.open_price + latest.high_price + latest.low_price) / 3;
  const lateMove = latest.close_price - intradayMidpoint;

  // If daily change is very small, check if close is near an extreme
  if (Math.abs(dailyChange) < 0.001) return null;

  const lateMoveRatio = Math.abs(lateMove) / Math.abs(dailyChange);

  if (lateMoveRatio > 0.5 && Math.abs(dailyChange / latest.open_price) > 0.005) {
    const isLateRally = lateMove > 0;
    return {
      type: 'late_session_anomaly',
      level: 'warning',
      label: isLateRally ? '⚠️ 尾盘拉升异动' : '⚠️ 尾盘跳水异动',
      description: isLateRally
        ? '收盘价明显偏离日内均价，可能存在尾盘拉升行为。这种走势往往不可持续，次日可能回落。'
        : '收盘价明显低于日内均价，可能存在尾盘打压行为。需关注是否有主力刻意压低股价吸筹。',
    };
  }

  return null;
}

/**
 * Detect false breakout: previous day broke above MA20 high but current day
 * closed below that level.
 */
export function detectFalseBreakout(history: MarketHistoryRow[]): RiskAlert | null {
  if (history.length < 22) return null; // Need at least 20 days for MA20 + 2 days

  const closes = history.map(r => r.close_price);

  // MA20 as of the day before yesterday (for the breakout reference)
  const ma20BeforeBreakout = calculateMA(closes.slice(0, -1), 20);
  if (ma20BeforeBreakout === null) return null;

  const prevDay = history[history.length - 2];
  const currentDay = history[history.length - 1];

  // Previous day broke above MA20 (close was above MA20)
  const prevBrokeAbove = prevDay.close_price > ma20BeforeBreakout;
  // Current day closed below MA20 level
  const currentBelowBreakout = currentDay.close_price < ma20BeforeBreakout;

  if (prevBrokeAbove && currentBelowBreakout) {
    return {
      type: 'false_breakout',
      level: 'danger',
      label: '⚠️ 疑似假突破，谨慎追高',
      description: '股价昨日突破20日均线后今日回落至均线下方，这是典型的假突破形态。主力可能利用突破吸引跟风盘后反手出货，追高风险较大。',
    };
  }

  return null;
}

/**
 * Run all risk detections for a stock and return RiskAlert array.
 */
export function detectRiskAlerts(stockCode: string, db?: Database.Database): RiskAlert[] {
  if (!isValidStockCode(stockCode)) {
    throw Errors.badRequest('股票代码无效，请输入正确的A股代码（6位数字）');
  }

  const database = db || getDatabase();
  const history = getMarketHistory(stockCode, database);

  if (history.length === 0) {
    return [];
  }

  const alerts: RiskAlert[] = [];

  const volumeAlert = detectVolumeDivergence(history);
  if (volumeAlert) alerts.push(volumeAlert);

  const lateSessionAlert = detectLateSessionAnomaly(history);
  if (lateSessionAlert) alerts.push(lateSessionAlert);

  const falseBreakoutAlert = detectFalseBreakout(history);
  if (falseBreakoutAlert) alerts.push(falseBreakoutAlert);

  return alerts;
}
