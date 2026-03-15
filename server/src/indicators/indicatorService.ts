import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { Errors } from '../errors/AppError';
import { isValidStockCode } from '../positions/positionService';

// --- Types ---

export type SignalDirection = 'bullish' | 'neutral' | 'bearish';

export interface Signal {
  direction: SignalDirection;
  label: string;
}

export interface IndicatorData {
  stockCode: string;
  tradeDate: string;
  ma: { ma5: number | null; ma10: number | null; ma20: number | null; ma60: number | null };
  macd: { dif: number | null; dea: number | null; histogram: number | null };
  kdj: { k: number | null; d: number | null; j: number | null };
  rsi: { rsi6: number | null; rsi12: number | null; rsi24: number | null };
  signals: {
    ma: Signal;
    macd: Signal;
    kdj: Signal;
    rsi: Signal;
  };
  updatedAt: string;
}

export interface MarketHistoryRow {
  trade_date: string;
  open_price: number;
  close_price: number;
  high_price: number;
  low_price: number;
  volume: number;
}

// --- Pure calculation functions ---

/**
 * Calculate Simple Moving Average for the last `period` close prices.
 * Returns null if not enough data.
 */
export function calculateMA(closePrices: number[], period: number): number | null {
  if (closePrices.length < period) return null;
  const slice = closePrices.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/**
 * Calculate EMA (Exponential Moving Average) for the full series.
 * Returns the array of EMA values (same length as input).
 * Uses SMA of first `period` values as the initial EMA seed.
 */
export function calculateEMASeries(closePrices: number[], period: number): number[] {
  if (closePrices.length < period) return [];
  const multiplier = 2 / (period + 1);
  const result: number[] = [];

  // Seed: SMA of first `period` values
  let ema = closePrices.slice(0, period).reduce((s, v) => s + v, 0) / period;
  // Fill initial values with NaN (not enough data)
  for (let i = 0; i < period - 1; i++) {
    result.push(NaN);
  }
  result.push(ema);

  for (let i = period; i < closePrices.length; i++) {
    ema = (closePrices[i] - ema) * multiplier + ema;
    result.push(ema);
  }
  return result;
}

/**
 * Calculate MACD: DIF = EMA12 - EMA26, DEA = EMA9(DIF), Histogram = 2*(DIF-DEA)
 * Returns { dif, dea, histogram } for the latest data point, or nulls if insufficient data.
 */
export function calculateMACD(closePrices: number[]): { dif: number | null; dea: number | null; histogram: number | null } {
  if (closePrices.length < 26) return { dif: null, dea: null, histogram: null };

  const ema12 = calculateEMASeries(closePrices, 12);
  const ema26 = calculateEMASeries(closePrices, 26);

  // DIF series starts from index 25 (where EMA26 first has a value)
  const difSeries: number[] = [];
  for (let i = 25; i < closePrices.length; i++) {
    difSeries.push(ema12[i] - ema26[i]);
  }

  if (difSeries.length < 9) {
    // Not enough DIF values to compute DEA (EMA9 of DIF)
    const dif = difSeries[difSeries.length - 1];
    return { dif, dea: null, histogram: null };
  }

  // DEA = EMA9 of DIF series
  const deaSeries = calculateEMASeries(difSeries, 9);
  const dif = difSeries[difSeries.length - 1];
  const dea = deaSeries[deaSeries.length - 1];
  const histogram = 2 * (dif - dea);

  return { dif, dea, histogram };
}

/**
 * Calculate KDJ indicator.
 * RSV = (close - lowest_low_9) / (highest_high_9 - lowest_low_9) * 100
 * K = 2/3 * prevK + 1/3 * RSV  (initial K = 50)
 * D = 2/3 * prevD + 1/3 * K    (initial D = 50)
 * J = 3K - 2D
 */
export function calculateKDJ(
  highs: number[],
  lows: number[],
  closes: number[]
): { k: number | null; d: number | null; j: number | null } {
  const period = 9;
  if (closes.length < period) return { k: null, d: null, j: null };

  let k = 50;
  let d = 50;

  for (let i = period - 1; i < closes.length; i++) {
    const highSlice = highs.slice(i - period + 1, i + 1);
    const lowSlice = lows.slice(i - period + 1, i + 1);
    const highestHigh = Math.max(...highSlice);
    const lowestLow = Math.min(...lowSlice);

    const range = highestHigh - lowestLow;
    const rsv = range === 0 ? 50 : ((closes[i] - lowestLow) / range) * 100;

    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
  }

  const j = 3 * k - 2 * d;
  return { k, d, j };
}

/**
 * Calculate RSI for a given period.
 * RS = avg_gain / avg_loss, RSI = 100 - 100/(1+RS)
 * Uses Wilder's smoothing method (exponential moving average of gains/losses).
 */
export function calculateRSI(closePrices: number[], period: number): number | null {
  if (closePrices.length < period + 1) return null;

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < closePrices.length; i++) {
    changes.push(closePrices[i] - closePrices[i - 1]);
  }

  // Initial average gain/loss from first `period` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing for remaining changes
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// --- Signal interpretation ---

export function interpretMA(
  closePrice: number,
  ma20: number | null
): Signal {
  if (ma20 === null) return { direction: 'neutral', label: '均线数据不足，暂无判断' };
  const diff = (closePrice - ma20) / ma20;
  if (diff > 0.02) return { direction: 'bullish', label: '股价在MA20上方，短期趋势偏多' };
  if (diff < -0.02) return { direction: 'bearish', label: '股价在MA20下方，短期趋势偏空' };
  return { direction: 'neutral', label: '股价在MA20附近，趋势不明朗' };
}

export function interpretMACD(
  dif: number | null,
  dea: number | null
): Signal {
  if (dif === null || dea === null) return { direction: 'neutral', label: 'MACD数据不足，暂无判断' };
  if (Math.abs(dif - dea) < 0.01) return { direction: 'neutral', label: 'MACD接近零轴，方向待确认' };
  if (dif > dea && dif > 0) return { direction: 'bullish', label: 'MACD金叉，短期看多' };
  if (dif < dea && dif < 0) return { direction: 'bearish', label: 'MACD死叉，短期看空' };
  if (dif > dea) return { direction: 'bullish', label: 'DIF在DEA上方，偏多信号' };
  return { direction: 'bearish', label: 'DIF在DEA下方，偏空信号' };
}

export function interpretKDJ(
  k: number | null,
  d: number | null,
  j: number | null
): Signal {
  if (k === null || d === null || j === null) return { direction: 'neutral', label: 'KDJ数据不足，暂无判断' };
  if (k < d && j < 20) return { direction: 'bullish', label: 'KDJ超卖区，可能存在反弹机会' };
  if (k > d && j > 80) return { direction: 'bearish', label: 'KDJ超买区，注意回调风险' };
  return { direction: 'neutral', label: 'KDJ处于中性区间，观望为主' };
}

export function interpretRSI(rsi: number | null): Signal {
  if (rsi === null) return { direction: 'neutral', label: 'RSI数据不足，暂无判断' };
  if (rsi > 70) return { direction: 'bearish', label: 'RSI超买，注意回调风险' };
  if (rsi < 30) return { direction: 'bullish', label: 'RSI超卖，可能存在反弹机会' };
  return { direction: 'neutral', label: 'RSI处于中性区间，趋势平稳' };
}

// --- Database operations ---

/**
 * Fetch market history for a stock, ordered by trade_date ASC.
 */
export function getMarketHistory(stockCode: string, db?: Database.Database): MarketHistoryRow[] {
  const database = db || getDatabase();
  return database
    .prepare('SELECT trade_date, open_price, close_price, high_price, low_price, volume FROM market_history WHERE stock_code = ? ORDER BY trade_date ASC')
    .all(stockCode) as MarketHistoryRow[];
}


/**
 * Calculate all technical indicators from market_history and save to technical_indicators table.
 * Returns the latest indicator data with signal interpretations.
 */
export function calculateAndCacheIndicators(stockCode: string, db?: Database.Database): IndicatorData | null {
  if (!isValidStockCode(stockCode)) {
    throw Errors.badRequest('股票代码无效，请输入正确的A股代码（6位数字）');
  }

  const database = db || getDatabase();
  const history = getMarketHistory(stockCode, database);

  if (history.length === 0) {
    throw Errors.notFound('该股票暂无历史行情数据');
  }

  const closes = history.map((r) => r.close_price);
  const highs = history.map((r) => r.high_price);
  const lows = history.map((r) => r.low_price);
  const latestDate = history[history.length - 1].trade_date;
  const latestClose = closes[closes.length - 1];

  // Calculate indicators
  const ma5 = calculateMA(closes, 5);
  const ma10 = calculateMA(closes, 10);
  const ma20 = calculateMA(closes, 20);
  const ma60 = calculateMA(closes, 60);

  const { dif, dea, histogram } = calculateMACD(closes);
  const { k, d, j } = calculateKDJ(highs, lows, closes);

  const rsi6 = calculateRSI(closes, 6);
  const rsi12 = calculateRSI(closes, 12);
  const rsi24 = calculateRSI(closes, 24);

  const now = new Date().toISOString();

  // Upsert into technical_indicators table
  database
    .prepare(
      `INSERT OR REPLACE INTO technical_indicators
       (stock_code, trade_date, ma5, ma10, ma20, ma60, dif, dea, macd_histogram, k_value, d_value, j_value, rsi6, rsi12, rsi24, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(stockCode, latestDate, ma5, ma10, ma20, ma60, dif, dea, histogram, k, d, j, rsi6, rsi12, rsi24, now);

  // Generate signals
  const signals = {
    ma: interpretMA(latestClose, ma20),
    macd: interpretMACD(dif, dea),
    kdj: interpretKDJ(k, d, j),
    rsi: interpretRSI(rsi12),
  };

  return {
    stockCode,
    tradeDate: latestDate,
    ma: { ma5, ma10, ma20, ma60 },
    macd: { dif, dea, histogram },
    kdj: { k, d, j },
    rsi: { rsi6, rsi12, rsi24 },
    signals,
    updatedAt: now,
  };
}

/**
 * Get cached indicators from DB. If not found, calculate and cache them.
 */
export function getIndicators(stockCode: string, db?: Database.Database): IndicatorData {
  if (!isValidStockCode(stockCode)) {
    throw Errors.badRequest('股票代码无效，请输入正确的A股代码（6位数字）');
  }

  const database = db || getDatabase();

  // Try to get cached data
  const row = database
    .prepare(
      `SELECT * FROM technical_indicators WHERE stock_code = ? ORDER BY trade_date DESC LIMIT 1`
    )
    .get(stockCode) as {
      stock_code: string;
      trade_date: string;
      ma5: number | null;
      ma10: number | null;
      ma20: number | null;
      ma60: number | null;
      dif: number | null;
      dea: number | null;
      macd_histogram: number | null;
      k_value: number | null;
      d_value: number | null;
      j_value: number | null;
      rsi6: number | null;
      rsi12: number | null;
      rsi24: number | null;
      updated_at: string;
    } | undefined;

  if (!row) {
    // No cached data, calculate fresh
    const result = calculateAndCacheIndicators(stockCode, database);
    if (!result) {
      throw Errors.notFound('该股票暂无技术指标数据');
    }
    return result;
  }

  // Get latest close price for signal interpretation
  const latestHistory = database
    .prepare('SELECT close_price FROM market_history WHERE stock_code = ? ORDER BY trade_date DESC LIMIT 1')
    .get(stockCode) as { close_price: number } | undefined;

  const latestClose = latestHistory?.close_price ?? 0;

  const signals = {
    ma: interpretMA(latestClose, row.ma20),
    macd: interpretMACD(row.dif, row.dea),
    kdj: interpretKDJ(row.k_value, row.d_value, row.j_value),
    rsi: interpretRSI(row.rsi12),
  };

  return {
    stockCode: row.stock_code,
    tradeDate: row.trade_date,
    ma: { ma5: row.ma5, ma10: row.ma10, ma20: row.ma20, ma60: row.ma60 },
    macd: { dif: row.dif, dea: row.dea, histogram: row.macd_histogram },
    kdj: { k: row.k_value, d: row.d_value, j: row.j_value },
    rsi: { rsi6: row.rsi6, rsi12: row.rsi12, rsi24: row.rsi24 },
    signals,
    updatedAt: row.updated_at,
  };
}
