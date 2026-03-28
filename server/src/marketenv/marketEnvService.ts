/**
 * 大盘环境判断服务
 *
 * 纯规则引擎，零AI调用。
 * 基于上证指数(000001)和沪深300(399300)的MA20/MA60趋势 + 成交量变化 + 涨跌家数比代理
 * 判断大盘环境：bull(牛市) / sideways(震荡) / bear(熊市)
 *
 * 判断逻辑：
 * 1. 两个指数MA20均>MA60 → 检查量能放大 → 检查涨跌比>1.5 → bull，否则sideways
 * 2. 两个指数MA20均<MA60 → 检查量能萎缩 → 检查涨跌比<0.7 → bear，否则sideways
 * 3. 一上一下 → sideways
 */
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { fetchKlineFromTencent } from '../market/historyService';

// --- Types ---

export type MarketEnvType = 'bull' | 'sideways' | 'bear';

export interface MarketEnvironment {
  environment: MarketEnvType;
  label: string;
  confidenceAdjust: number;
  riskTip: string | null;
  indicators: {
    shIndex: { ma20Trend: string; ma60Trend: string };
    hs300: { ma20Trend: string; ma60Trend: string };
    volumeChange: number;
    advanceDeclineRatio: number;
  };
  updatedAt: string;
}

// --- Constants ---

const ENV_LABELS: Record<MarketEnvType, string> = {
  bull: '牛市 🐂',
  sideways: '震荡 ⚖️',
  bear: '熊市 🐻',
};

const BEAR_CONFIDENCE_ADJUST = -15;
const BEAR_RISK_TIP = '当前大盘处于熊市环境，操作需谨慎，注意控制仓位';

const INDEX_CODES = {
  sh: '000001',
  hs300: '399300',
};

// --- Helper: get K-line data from DB, fallback to Tencent API ---

function getKlineFromDb(
  stockCode: string,
  days: number,
  db: Database.Database
): { close: number; volume: number; date: string }[] {
  const rows = db.prepare(
    `SELECT trade_date, close_price, volume FROM market_history
     WHERE stock_code = ? ORDER BY trade_date DESC LIMIT ?`
  ).all(stockCode, days) as { trade_date: string; close_price: number; volume: number }[];

  return rows.map(r => ({ close: r.close_price, volume: r.volume, date: r.trade_date }));
}

async function getKlineData(
  stockCode: string,
  days: number,
  db: Database.Database
): Promise<{ close: number; volume: number; date: string }[]> {
  const dbRows = getKlineFromDb(stockCode, days, db);
  if (dbRows.length >= days) {
    return dbRows;
  }

  // Fallback: fetch from Tencent API
  const now = new Date();
  const start = new Date();
  start.setDate(start.getDate() - Math.ceil(days * 1.8));
  const startStr = start.toISOString().slice(0, 10);
  const endStr = now.toISOString().slice(0, 10);

  try {
    const klines = await fetchKlineFromTencent(stockCode, startStr, endStr);
    if (klines.length > 0) {
      const recent = klines.slice(-days);
      return recent.map(k => ({ close: k.close, volume: k.volume, date: k.tradeDate }));
    }
  } catch {
    // API failed, fall through
  }

  return dbRows;
}

// --- Core pure functions ---

/**
 * Calculate moving average from an array of prices.
 * Prices should be in chronological order (oldest first).
 * Returns NaN if insufficient data.
 */
export function calculateMA(prices: number[], period: number): number {
  if (prices.length < period) return NaN;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

/**
 * Determine trend direction based on MA20 vs MA60.
 * Returns 'up' if MA20 > MA60, 'down' otherwise.
 */
export function determineTrend(ma20: number, ma60: number): 'up' | 'down' {
  if (isNaN(ma20) || isNaN(ma60)) return 'down';
  return ma20 > ma60 ? 'up' : 'down';
}

/**
 * Classify market environment based on indicators.
 *
 * Logic (from design doc flowchart):
 * - Both indices MA20 > MA60 → check volume expanding → check advance/decline > 1.5 → bull, else sideways
 * - Both indices MA20 < MA60 → check volume shrinking → check advance/decline < 0.7 → bear, else sideways
 * - Mixed → sideways
 */
export function classifyEnvironment(
  shTrend: 'up' | 'down',
  hs300Trend: 'up' | 'down',
  volumeChange: number,
  advanceDeclineRatio: number
): { environment: MarketEnvType; label: string; confidenceAdjust: number; riskTip: string | null } {
  const bothUp = shTrend === 'up' && hs300Trend === 'up';
  const bothDown = shTrend === 'down' && hs300Trend === 'down';

  if (bothUp) {
    // Volume expanding = volumeChange > 1 (recent avg > longer avg)
    if (volumeChange > 1) {
      if (advanceDeclineRatio > 1.5) {
        return { environment: 'bull', label: ENV_LABELS.bull, confidenceAdjust: 0, riskTip: null };
      }
    }
    return { environment: 'sideways', label: ENV_LABELS.sideways, confidenceAdjust: 0, riskTip: null };
  }

  if (bothDown) {
    // Volume shrinking = volumeChange < 1
    if (volumeChange < 1) {
      if (advanceDeclineRatio < 0.7) {
        return {
          environment: 'bear',
          label: ENV_LABELS.bear,
          confidenceAdjust: BEAR_CONFIDENCE_ADJUST,
          riskTip: BEAR_RISK_TIP,
        };
      }
    }
    return { environment: 'sideways', label: ENV_LABELS.sideways, confidenceAdjust: 0, riskTip: null };
  }

  // Mixed
  return { environment: 'sideways', label: ENV_LABELS.sideways, confidenceAdjust: 0, riskTip: null };
}

/**
 * Calculate volume change ratio: recent 5-day avg volume / 20-day avg volume.
 * Values > 1 indicate expanding volume, < 1 indicate shrinking.
 */
function calculateVolumeChange(data: { volume: number }[]): number {
  if (data.length < 5) return 1;

  const recent5 = data.slice(-5).map(d => d.volume);
  const all20 = data.slice(-20).map(d => d.volume);

  const avg5 = recent5.reduce((s, v) => s + v, 0) / recent5.length;
  const avg20 = all20.length > 0
    ? all20.reduce((s, v) => s + v, 0) / all20.length
    : 1;

  return avg20 > 0 ? avg5 / avg20 : 1;
}

/**
 * Calculate advance/decline ratio proxy.
 * Since we don't have individual stock data, we use the ratio of
 * Shanghai index daily change to its absolute change as a directional proxy.
 * Positive days with larger gains → higher ratio (bullish breadth).
 * We count recent positive-change days vs negative-change days in last 10 days.
 */
function calculateAdvanceDeclineProxy(data: { close: number }[]): number {
  if (data.length < 3) return 1;

  const recent = data.slice(-11); // need 11 to get 10 daily changes
  let advances = 0;
  let declines = 0;

  for (let i = 1; i < recent.length; i++) {
    const change = recent[i].close - recent[i - 1].close;
    if (change > 0) advances++;
    else if (change < 0) declines++;
  }

  if (declines === 0) return advances > 0 ? 2.0 : 1.0;
  return advances / declines;
}

// --- DB operations ---

/**
 * Get the latest market environment from DB.
 */
export function getCurrentMarketEnv(db?: Database.Database): MarketEnvironment | null {
  const database = db || getDatabase();

  const row = database.prepare(
    `SELECT * FROM market_environment ORDER BY updated_at DESC LIMIT 1`
  ).get() as {
    id: number;
    environment: string;
    label: string;
    confidence_adjust: number;
    risk_tip: string | null;
    sh_ma20_trend: string;
    sh_ma60_trend: string;
    hs300_ma20_trend: string;
    hs300_ma60_trend: string;
    volume_change: number;
    advance_decline_ratio: number;
    updated_at: string;
  } | undefined;

  if (!row) return null;

  return {
    environment: row.environment as MarketEnvType,
    label: row.label,
    confidenceAdjust: row.confidence_adjust,
    riskTip: row.risk_tip,
    indicators: {
      shIndex: { ma20Trend: row.sh_ma20_trend, ma60Trend: row.sh_ma60_trend },
      hs300: { ma20Trend: row.hs300_ma20_trend, ma60Trend: row.hs300_ma60_trend },
      volumeChange: row.volume_change,
      advanceDeclineRatio: row.advance_decline_ratio,
    },
    updatedAt: row.updated_at,
  };
}

/**
 * Create market_env_change messages for all active users.
 */
function createEnvChangeMessages(
  previousEnv: MarketEnvType,
  previousLabel: string,
  currentEnv: MarketEnvType,
  currentLabel: string,
  indicators: MarketEnvironment['indicators'],
  db: Database.Database
): void {
  // Active users = logged in within last 24 hours
  const users = db.prepare(
    `SELECT id FROM users WHERE last_login_at > datetime('now', '-24 hours')`
  ).all() as { id: number }[];

  // Fallback: if no recent users, get all users
  const targetUsers = users.length > 0
    ? users
    : db.prepare('SELECT id FROM users').all() as { id: number }[];

  if (targetUsers.length === 0) return;

  const summary = `大盘环境变化：${previousLabel} → ${currentLabel}`;
  const detail = JSON.stringify({
    previousEnvironment: previousEnv,
    previousLabel,
    currentEnvironment: currentEnv,
    currentLabel,
    indicators,
  });
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read, created_at)
     VALUES (?, 'market_env_change', '', '大盘环境', ?, ?, 0, ?)`
  );

  const insertAll = db.transaction(() => {
    for (const user of targetUsers) {
      stmt.run(user.id, summary, detail, now);
    }
  });

  insertAll();
}

/**
 * Main update function: fetch index data, calculate indicators, classify environment,
 * detect switch, persist to DB, and notify users on change.
 */
export async function updateMarketEnv(db?: Database.Database): Promise<MarketEnvironment> {
  const database = db || getDatabase();

  // Need at least 60 days of data for MA60
  const [shData, hs300Data] = await Promise.all([
    getKlineData(INDEX_CODES.sh, 70, database),
    getKlineData(INDEX_CODES.hs300, 70, database),
  ]);

  // Sort chronologically (DB returns DESC)
  const shSorted = [...shData].sort((a, b) => a.date.localeCompare(b.date));
  const hs300Sorted = [...hs300Data].sort((a, b) => a.date.localeCompare(b.date));

  // Calculate MAs
  const shPrices = shSorted.map(d => d.close);
  const hs300Prices = hs300Sorted.map(d => d.close);

  const shMA20 = calculateMA(shPrices, 20);
  const shMA60 = calculateMA(shPrices, 60);
  const hs300MA20 = calculateMA(hs300Prices, 20);
  const hs300MA60 = calculateMA(hs300Prices, 60);

  // Determine trends
  const shTrend = determineTrend(shMA20, shMA60);
  const hs300Trend = determineTrend(hs300MA20, hs300MA60);

  // Calculate volume change (use Shanghai index as primary)
  const volumeChange = calculateVolumeChange(shSorted);

  // Calculate advance/decline ratio proxy
  const advanceDeclineRatio = calculateAdvanceDeclineProxy(shSorted);

  // Classify environment
  const classification = classifyEnvironment(shTrend, hs300Trend, volumeChange, advanceDeclineRatio);

  const now = new Date().toISOString();

  const indicators: MarketEnvironment['indicators'] = {
    shIndex: { ma20Trend: shTrend, ma60Trend: shTrend === 'up' ? 'below_ma20' : 'above_ma20' },
    hs300: { ma20Trend: hs300Trend, ma60Trend: hs300Trend === 'up' ? 'below_ma20' : 'above_ma20' },
    volumeChange: Math.round(volumeChange * 100) / 100,
    advanceDeclineRatio: Math.round(advanceDeclineRatio * 100) / 100,
  };

  // Get previous environment for switch detection
  const previous = getCurrentMarketEnv(database);
  const previousEnv = previous?.environment ?? null;
  const envChanged = previousEnv !== null && previousEnv !== classification.environment;

  // Persist to market_environment table
  database.prepare(
    `INSERT INTO market_environment
     (environment, label, confidence_adjust, risk_tip,
      sh_ma20_trend, sh_ma60_trend, hs300_ma20_trend, hs300_ma60_trend,
      volume_change, advance_decline_ratio, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    classification.environment,
    classification.label,
    classification.confidenceAdjust,
    classification.riskTip,
    indicators.shIndex.ma20Trend,
    indicators.shIndex.ma60Trend,
    indicators.hs300.ma20Trend,
    indicators.hs300.ma60Trend,
    indicators.volumeChange,
    indicators.advanceDeclineRatio,
    now
  );

  // Create messages if environment changed
  if (envChanged && previousEnv && previous) {
    createEnvChangeMessages(
      previousEnv,
      previous.label,
      classification.environment,
      classification.label,
      indicators,
      database
    );
  }

  return {
    environment: classification.environment,
    label: classification.label,
    confidenceAdjust: classification.confidenceAdjust,
    riskTip: classification.riskTip,
    indicators,
    updatedAt: now,
  };
}
