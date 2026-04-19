/**
 * 周期底部检测服务
 *
 * 纯规则引擎，零AI调用。
 * 底部信号检测（至少满足2项）：
 *   1. 价格处于「自适应历史窗口」最低30%区间（最多约10年数据；窗口按谷值间距/品种先验/可用跨度因股而异）
 *   2. 成交量萎缩后放大（近5日均量 > 20日均量 且 20日均量 < 60日均量）
 *   3. RSI<30 或 MACD底背离（价格创新低但MACD柱不创新低）
 *
 * 状态判定：
 *   - bottom: 2+底部信号触发
 *   - falling: 价格低于MA60，趋势下行
 *   - rising: 价格高于MA20和MA60，趋势上行
 *   - high: 价格处于同一自适应窗口内最高30%区间
 */
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { calculateRSI, calculateMACD, calculateMA, calculateEMASeries } from '../indicators/indicatorService';
import { fetchAndSaveStockHistory } from '../market/historyService';
import { getQuote } from '../market/marketDataService';

// --- Predefined cycle knowledge for common commodity/sector ETFs ---
// 当历史数据不足以自动检测周期时，使用预定义的行业周期知识作为fallback
// 数据来源：大宗商品历史周期规律

interface PredefinedCycle {
  cycleLength: string;       // 一轮周期描述
  phases: string;            // 涨→跌→横 节奏
  avgCycleYears: number;     // 平均周期年数
}

// ETF名称→代码硬编码映射，用于 market_cache 和 hs300_constituents 都查不到时的兜底
const ETF_NAME_TO_CODE: Record<string, string> = {
  '黄金ETF': '518880', '煤炭ETF': '515220', '化工ETF': '516020',
  '白银ETF': '161226', '有色ETF': '512400', '橡胶ETF': '159886',
  '原油ETF': '161129', '豆粕ETF': '159985',
};

/** 名称与 ETF_NAME_TO_CODE 键大小写不一致时（如「煤炭etf」）仍能解析到 6 位代码 */
function matchPredefinedEtf(input: string): { code: string; canonicalName: string } | undefined {
  const trimmed = input.trim();
  if (ETF_NAME_TO_CODE[trimmed]) {
    return { code: ETF_NAME_TO_CODE[trimmed], canonicalName: trimmed };
  }
  const lower = trimmed.toLowerCase();
  const key = Object.keys(ETF_NAME_TO_CODE).find((k) => k.toLowerCase() === lower);
  if (key) return { code: ETF_NAME_TO_CODE[key], canonicalName: key };
  return undefined;
}

const PREDEFINED_CYCLES: Record<string, PredefinedCycle> = {
  '159985': { cycleLength: '一轮周期约6年（涨2年→跌2年→横2年）', phases: '涨2年→跌2年→横2年', avgCycleYears: 6 },
  '515220': { cycleLength: '一轮周期约4年（涨1.5年→跌1.5年→横1年）', phases: '涨1.5年→跌1.5年→横1年', avgCycleYears: 4 },
  '518880': { cycleLength: '康波长周期（信用周期见顶→美元贬值→黄金长牛）', phases: '长周期', avgCycleYears: 10 },
  '161226': { cycleLength: '跟随黄金周期，波动更大（涨2年→跌1.5年→横1.5年）', phases: '涨2年→跌1.5年→横1.5年', avgCycleYears: 5 },
  '512400': { cycleLength: '一轮周期约3-4年（涨1年→跌1.5年→横1年）', phases: '涨1年→跌1.5年→横1年', avgCycleYears: 3.5 },
  '516020': { cycleLength: '一轮周期约3-4年（涨1年→跌1.5年→横1年）', phases: '涨1年→跌1.5年→横1年', avgCycleYears: 3.5 },
  '159886': { cycleLength: '一轮周期约4-5年（涨1.5年→跌2年→横1年）', phases: '涨1.5年→跌2年→横1年', avgCycleYears: 4.5 },
  '161129': { cycleLength: '一轮周期约3-5年（涨1-2年→跌1-2年→横1年）', phases: '涨1-2年→跌1-2年→横1年', avgCycleYears: 4 },
};

// --- Types ---

export type CycleStatus = 'bottom' | 'falling' | 'rising' | 'high';

export interface CycleMonitor {
  id: number;
  userId: number;
  stockCode: string;
  stockName: string;
  cycleLength: string | null;
  currentPhase: string | null;
  status: CycleStatus;
  description: string | null;
  bottomSignals: string[];
  updatedAt: string;
  currentMonths: number | null;
  cycleLengthMonths: number | null;
  currentPrice: number | null;
  changePercent: number | null;
}

export interface BottomSignalResult {
  signals: string[];
  status: CycleStatus;
  description: string;
  cycleLength: string | null;
  currentPhase: string | null;
  /** 本次判定使用的历史区间跨度（年，约 0.5 年粒度），因标的与数据更新而变化 */
  analysisWindowYears: number | null;
  /** 分析窗口内收盘最低价、最高价 */
  rangeMin: number | null;
  rangeMax: number | null;
  /** 分析窗口末根 K 线收盘价，用于消息摘要 */
  anchorPrice: number | null;
}

interface MarketHistoryRow {
  trade_date: string;
  close_price: number;
  high_price: number;
  low_price: number;
  volume: number;
}

interface HistoryPriceRow {
  trade_date: string;
  close_price: number;
}

// --- Helpers ---

/** 从 cycleLength 字符串（如"约7个月"、"约3年"、"一轮周期约6年（...）"、"康波长周期"）解析出总月数 */
function parseCycleLengthMonths(cycleLength: string | null): number | null {
  if (!cycleLength) return null;
  // "约7个月"
  const monthMatch = cycleLength.match(/约(\d+)个月/);
  if (monthMatch) return parseInt(monthMatch[1], 10);
  // "约3年"
  const yearMatch = cycleLength.match(/约(\d+)年/);
  if (yearMatch) return parseInt(yearMatch[1], 10) * 12;
  // "一轮周期约N年（...）" or "一轮周期约N-M年（...）"
  const predefinedMatch = cycleLength.match(/约(\d+)(?:-\d+)?年/);
  if (predefinedMatch) return parseInt(predefinedMatch[1], 10) * 12;
  // "康波长周期" — 黄金等超长周期，约10年
  if (cycleLength.includes('长周期') || cycleLength.includes('康波')) return 120;
  return null;
}

/** 从 description 字符串中解析"已XX约N个月"或"已XX约N.N年"的持续月数 */
function parseCurrentMonths(description: string | null): number | null {
  if (!description) return null;
  const monthMatch = description.match(/已(?:跌|涨|横盘|运行)约(\d+)个月/);
  if (monthMatch) return parseInt(monthMatch[1], 10);
  const yearMatch = description.match(/已(?:跌|涨|横盘|运行)约([\d.]+)年/);
  if (yearMatch) return Math.round(parseFloat(yearMatch[1]) * 12);
  return null;
}

function toResponse(row: any, db: Database.Database): CycleMonitor {
  const cycleLength = row.cycle_length as string | null;
  const description = row.description as string | null;
  const stockCode = row.stock_code as string;

  // Get latest price from market_cache
  const marketRow = db.prepare('SELECT price, change_percent FROM market_cache WHERE stock_code = ?').get(stockCode) as
    { price: number; change_percent: number } | undefined;

  return {
    id: row.id,
    userId: row.user_id,
    stockCode: stockCode,
    stockName: row.stock_name,
    cycleLength: cycleLength,
    currentPhase: row.current_phase,
    status: row.status as CycleStatus,
    description: description,
    bottomSignals: row.bottom_signals ? JSON.parse(row.bottom_signals) : [],
    updatedAt: row.updated_at,
    currentMonths: parseCurrentMonths(description),
    cycleLengthMonths: parseCycleLengthMonths(cycleLength),
    currentPrice: marketRow?.price ?? null,
    changePercent: marketRow?.change_percent ?? null,
  };
}

function upsertMarketCache(
  stockCode: string,
  stockName: string,
  price: number,
  changePercent: number,
  volume: number | null,
  updatedAt: string,
  db: Database.Database
): void {
  db.prepare(
    `INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at)
     VALUES (?, ?, ?, ?, COALESCE(?, (SELECT volume FROM market_cache WHERE stock_code = ?), 0), ?)`
  ).run(stockCode, stockName, price, changePercent, volume ?? null, stockCode, updatedAt);
}

function fallbackPriceFromHistory(
  stockCode: string,
  stockName: string,
  db: Database.Database
): { stockName: string; price: number; changePercent: number; updatedAt: string } | null {
  const latestRows = db.prepare(
    `SELECT trade_date, close_price
     FROM market_history
     WHERE stock_code = ?
     ORDER BY trade_date DESC
     LIMIT 2`
  ).all(stockCode) as HistoryPriceRow[];

  if (latestRows.length === 0) return null;

  const latest = latestRows[0];
  const prev = latestRows[1];
  const changePercent =
    prev && prev.close_price > 0
      ? ((latest.close_price - prev.close_price) / prev.close_price) * 100
      : 0;

  const cachedName = db.prepare(
    'SELECT stock_name FROM market_cache WHERE stock_code = ?'
  ).get(stockCode) as { stock_name: string } | undefined;

  return {
    stockName: cachedName?.stock_name || stockName || stockCode,
    price: latest.close_price,
    changePercent,
    // 使用最后一个交易日的收盘时间作为更新时间，便于前端识别是最近有效交易日价格
    updatedAt: `${latest.trade_date}T15:00:00.000+08:00`,
  };
}

async function refreshSingleMonitorPrice(
  stockCode: string,
  stockName: string,
  db: Database.Database
): Promise<void> {
  try {
    const quote = await getQuote(stockCode, db);
    upsertMarketCache(
      quote.stockCode,
      quote.stockName || stockName || quote.stockCode,
      quote.price,
      quote.changePercent,
      quote.volume,
      quote.timestamp,
      db
    );
    return;
  } catch {
    // 行情接口不可用或非交易时段，回退到最近交易日收盘价
  }

  const fallback = fallbackPriceFromHistory(stockCode, stockName, db);
  if (!fallback) return;
  upsertMarketCache(
    stockCode,
    fallback.stockName,
    fallback.price,
    fallback.changePercent,
    null,
    fallback.updatedAt,
    db
  );
}

// --- Core detection functions ---

const MAX_HISTORY_YEARS = 10;

/**
 * 取最近 `years` 个日历年内的行情（升序）。用于固定窗口或兼容旧逻辑。
 */
export function getMarketHistoryLastYears(
  stockCode: string,
  db: Database.Database,
  years: number
): MarketHistoryRow[] {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  const startDate = d.toISOString().slice(0, 10);

  return db.prepare(
    `SELECT trade_date, close_price, high_price, low_price, volume
     FROM market_history WHERE stock_code = ? AND trade_date >= ?
     ORDER BY trade_date ASC`
  ).all(stockCode, startDate) as MarketHistoryRow[];
}

/**
 * Get 3-year market history for a stock (sorted ASC by date).
 * @deprecated 新逻辑请用 getMarketHistoryLastYears(..., 10) + 自适应窗口；保留供测试与兼容。
 */
export function get3YearHistory(stockCode: string, db: Database.Database): MarketHistoryRow[] {
  return getMarketHistoryLastYears(stockCode, db, 3);
}

/** 从首末根 K 线推算覆盖年数，并与按根数估算的年数取较大值，上限 MAX_HISTORY_YEARS */
function calendarSpanYears(history: MarketHistoryRow[]): number {
  if (history.length === 0) return 0;
  const firstMs = new Date(`${history[0].trade_date}T12:00:00`).getTime();
  const lastMs = new Date(`${history[history.length - 1].trade_date}T12:00:00`).getTime();
  const calYears = (lastMs - firstMs) / (365.25 * 86400e3);
  const barYears = history.length / 250;
  const span = Math.max(calYears, barYears * 0.98);
  return Math.min(MAX_HISTORY_YEARS, Math.max(span, 1 / 250));
}

/** 谷值间距（交易日）均值；不足两个谷或数据太短则 null */
function getAverageTroughSpacingDays(history: MarketHistoryRow[]): number | null {
  if (history.length < 250) return null;
  const closes = history.map(r => r.close_price);
  const troughIndices: number[] = [];
  const windowSize = 60;

  for (let i = windowSize; i < closes.length - windowSize; i++) {
    const windowBefore = closes.slice(i - windowSize, i);
    const windowAfter = closes.slice(i + 1, i + windowSize + 1);
    const minBefore = Math.min(...windowBefore);
    const minAfter = Math.min(...windowAfter);

    if (closes[i] <= minBefore && closes[i] <= minAfter) {
      if (troughIndices.length === 0 || i - troughIndices[troughIndices.length - 1] >= 120) {
        troughIndices.push(i);
      }
    }
  }

  if (troughIndices.length < 2) return null;
  const cycleLengths: number[] = [];
  for (let i = 1; i < troughIndices.length; i++) {
    cycleLengths.push(troughIndices[i] - troughIndices[i - 1]);
  }
  return cycleLengths.reduce((s, v) => s + v, 0) / cycleLengths.length;
}

/**
 * 根据谷值周期 / 品种先验 / 可用数据跨度，确定用于分位与均线判定的目标年数（不含超过库内 span 的裁剪，在调用方做 min）。
 */
function resolveTargetWindowYears(
  fullHistory: MarketHistoryRow[],
  stockCode: string,
  span: number
): number {
  if (span <= 0) return 3;
  const spacingDays = getAverageTroughSpacingDays(fullHistory);
  const troughYears = spacingDays != null ? spacingDays / 250 : null;
  const presetYears = PREDEFINED_CYCLES[stockCode]?.avgCycleYears ?? null;

  if (troughYears != null && troughYears >= 0.35) {
    const rooted = Math.max(Math.min(2.5, span), 1.85 * troughYears);
    return Math.min(MAX_HISTORY_YEARS, rooted);
  }
  if (presetYears != null) {
    const rooted = Math.max(Math.min(2.5, span), 1.85 * presetYears);
    return Math.min(MAX_HISTORY_YEARS, rooted);
  }
  return Math.min(MAX_HISTORY_YEARS, span);
}

function sliceHistoryByYears(historyAsc: MarketHistoryRow[], years: number): MarketHistoryRow[] {
  if (historyAsc.length === 0 || years <= 0) return historyAsc;
  const last = historyAsc[historyAsc.length - 1].trade_date;
  const lastMs = new Date(`${last}T12:00:00`).getTime();
  if (!Number.isFinite(lastMs)) return historyAsc;
  const cutoffMs = lastMs - years * 365.25 * 86400e3;
  if (!Number.isFinite(cutoffMs)) return historyAsc;
  const cutoffStr = new Date(cutoffMs).toISOString().slice(0, 10);
  return historyAsc.filter((r) => r.trade_date >= cutoffStr);
}

function formatAnalysisYearsLabel(years: number): string {
  const rounded = Math.round(years * 2) / 2;
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) return String(Math.round(rounded));
  return rounded.toFixed(1).replace(/\.0$/, '');
}

/**
 * 在最多 10 年全量序列上，裁剪出本次分析用的窗口，并给出用于文案的年数标签。
 */
export function pickAdaptiveAnalysisWindow(
  fullHistory: MarketHistoryRow[],
  stockCode: string
): { windowHistory: MarketHistoryRow[]; labelYears: number | null; targetYears: number } {
  if (fullHistory.length === 0) {
    return { windowHistory: [], labelYears: null, targetYears: 0 };
  }

  const span = calendarSpanYears(fullHistory);
  const targetYears = resolveTargetWindowYears(fullHistory, stockCode, span);
  const cappedTarget = Math.min(targetYears, span);
  let windowHistory = sliceHistoryByYears(fullHistory, cappedTarget);

  if (windowHistory.length < 20 && fullHistory.length >= 20) {
    windowHistory = fullHistory.slice(-Math.min(fullHistory.length, 500));
  }

  const labelSpan = calendarSpanYears(windowHistory);
  const labelYears = labelSpan > 0 ? Math.round(labelSpan * 2) / 2 : null;

  return { windowHistory, labelYears, targetYears: cappedTarget };
}

export function formatPriceLowSignalText(labelYears: number | null): string {
  const label = labelYears != null && labelYears > 0 ? formatAnalysisYearsLabel(labelYears) : '历史';
  return `价格处于近${label}年最低30%区间`;
}

/**
 * Signal 1: Price in lowest 30% of the analysis window range.
 * (currentPrice - min) / (max - min) <= 0.3
 */
export function checkPriceLow30(history: MarketHistoryRow[]): boolean {
  if (history.length < 20) return false;

  const closes = history.map(r => r.close_price);
  const min3y = Math.min(...closes);
  const max3y = Math.max(...closes);
  const currentPrice = closes[closes.length - 1];

  const range = max3y - min3y;
  if (range <= 0) return false;

  return (currentPrice - min3y) / range <= 0.3;
}

/**
 * Signal 2: Volume shrink then expand.
 * Recent 5-day avg volume > 20-day avg volume AND 20-day avg volume < 60-day avg volume.
 */
export function checkVolumeShrinkExpand(history: MarketHistoryRow[]): boolean {
  if (history.length < 60) return false;

  const volumes = history.map(r => r.volume);
  const len = volumes.length;

  const avg5 = volumes.slice(len - 5).reduce((s, v) => s + v, 0) / 5;
  const avg20 = volumes.slice(len - 20).reduce((s, v) => s + v, 0) / 20;
  const avg60 = volumes.slice(len - 60).reduce((s, v) => s + v, 0) / 60;

  return avg5 > avg20 && avg20 < avg60;
}

/**
 * Signal 3: RSI < 30 OR MACD histogram divergence.
 * MACD divergence: price making new low but MACD histogram not making new low.
 */
export function checkRsiOrMacdDivergence(history: MarketHistoryRow[]): boolean {
  if (history.length < 60) return false;

  const closes = history.map(r => r.close_price);

  // Check RSI < 30 (using RSI14)
  const rsi = calculateRSI(closes, 14);
  if (rsi !== null && rsi < 30) return true;

  // Check MACD histogram divergence
  return checkMacdDivergence(closes);
}

/**
 * MACD histogram divergence detection.
 * Compare recent 20-day low vs previous 20-day low:
 * If price made a new low but MACD histogram didn't, that's bullish divergence.
 */
export function checkMacdDivergence(closes: number[]): boolean {
  if (closes.length < 60) return false;

  // Calculate full MACD histogram series
  const ema12 = calculateEMASeries(closes, 12);
  const ema26 = calculateEMASeries(closes, 26);

  if (ema12.length < closes.length || ema26.length < closes.length) return false;

  const difSeries: number[] = [];
  for (let i = 25; i < closes.length; i++) {
    difSeries.push(ema12[i] - ema26[i]);
  }

  if (difSeries.length < 9) return false;

  const deaSeries = calculateEMASeries(difSeries, 9);
  if (deaSeries.length < difSeries.length) return false;

  const histogramSeries: number[] = [];
  for (let i = 0; i < difSeries.length; i++) {
    if (i < 8 || isNaN(deaSeries[i])) {
      histogramSeries.push(0);
    } else {
      histogramSeries.push(2 * (difSeries[i] - deaSeries[i]));
    }
  }

  // Compare two windows: recent 20 bars vs previous 20 bars
  if (histogramSeries.length < 40) return false;

  const len = histogramSeries.length;
  const recentHistogram = histogramSeries.slice(len - 20);
  const previousHistogram = histogramSeries.slice(len - 40, len - 20);

  // Corresponding price windows (offset by 25 since histogram starts at index 25)
  const priceOffset = closes.length - histogramSeries.length;
  const recentPrices = closes.slice(closes.length - 20);
  const previousPrices = closes.slice(closes.length - 40, closes.length - 20);

  if (previousPrices.length < 20 || recentPrices.length < 20) return false;

  const recentPriceLow = Math.min(...recentPrices);
  const previousPriceLow = Math.min(...previousPrices);
  const recentHistLow = Math.min(...recentHistogram);
  const previousHistLow = Math.min(...previousHistogram);

  // Divergence: price made new low but histogram didn't
  return recentPriceLow < previousPriceLow && recentHistLow > previousHistLow;
}

/**
 * Determine cycle status based on price position and moving averages.
 */
export function determineStatus(history: MarketHistoryRow[], signals: string[]): CycleStatus {
  // If 2+ bottom signals, it's bottom
  if (signals.length >= 2) return 'bottom';

  if (history.length < 60) return 'falling';

  const closes = history.map(r => r.close_price);
  const currentPrice = closes[closes.length - 1];
  const min3y = Math.min(...closes);
  const max3y = Math.max(...closes);
  const range = max3y - min3y;

  // High: price in top 30% of analysis window range
  if (range > 0 && (currentPrice - min3y) / range >= 0.7) return 'high';

  const ma20 = calculateMA(closes, 20);
  const ma60 = calculateMA(closes, 60);

  // Rising: price above MA20 and MA60
  if (ma20 !== null && ma60 !== null && currentPrice > ma20 && currentPrice > ma60) return 'rising';

  // Falling: price below MA60
  if (ma60 !== null && currentPrice < ma60) return 'falling';

  return 'falling';
}

/**
 * Estimate cycle length from historical data.
 * Looks for price troughs to estimate cycle period.
 */
export function estimateCycleLength(history: MarketHistoryRow[], stockCode?: string): string | null {
  const avgDays = getAverageTroughSpacingDays(history);
  if (avgDays != null) {
    const avgYears = avgDays / 250;
    if (avgYears < 1) return `约${Math.round(avgDays / 20)}个月`;
    return `约${Math.round(avgYears)}年`;
  }

  // Fallback: 使用预定义周期知识
  if (stockCode && PREDEFINED_CYCLES[stockCode]) {
    return PREDEFINED_CYCLES[stockCode].cycleLength;
  }

  return null;
}

/**
 * Determine current phase description.
 * Must clearly state: cycle rhythm, current position, duration, distance to next phase.
 */
export function generateDescription(
  history: MarketHistoryRow[],
  status: CycleStatus,
  cycleLength: string | null,
  signals: string[],
  stockCode?: string,
  analysisWindowYears?: number | null
): string {
  if (history.length < 20) {
    // 即使历史数据不足，如果有预定义周期知识也给出描述
    if (stockCode && PREDEFINED_CYCLES[stockCode]) {
      const pc = PREDEFINED_CYCLES[stockCode];
      return `当前数据有限，根据行业周期规律（${pc.phases}），请持续关注`;
    }
    return '历史数据不足，暂无法判断周期位置';
  }

  const closes = history.map(r => r.close_price);
  const currentPrice = closes[closes.length - 1];
  const min3y = Math.min(...closes);
  const max3y = Math.max(...closes);
  const range = max3y - min3y;

  // 计算当前趋势持续时间
  const ma60 = calculateMA(closes, 60);
  let trendDays = 0;
  if (ma60 !== null) {
    for (let i = closes.length - 1; i >= 0; i--) {
      const isAbove = closes[i] > ma60;
      const currentAbove = currentPrice > ma60;
      if (isAbove !== currentAbove) break;
      trendDays++;
    }
  }
  const trendMonths = Math.round(trendDays / 20);
  const trendYears = (trendMonths / 12).toFixed(1);

  // 使用预定义周期知识生成更丰富的描述
  const pc = stockCode ? PREDEFINED_CYCLES[stockCode] : undefined;

  const statusLabels: Record<CycleStatus, string> = {
    bottom: '底部区域',
    falling: '下跌阶段',
    rising: '上涨阶段',
    high: '高位运行',
  };

  const phaseLabel = statusLabels[status];

  // 构建持续时间描述
  const verb = status === 'falling' ? '跌' : status === 'rising' ? '涨' : status === 'bottom' ? '横盘' : '运行';
  let durationStr = '';
  if (trendMonths >= 12) {
    durationStr = `已${verb}约${trendYears}年`;
  } else if (trendMonths > 0) {
    durationStr = `已${verb}约${trendMonths}个月`;
  } else {
    durationStr = `已${verb}约1个月`;
  }

  // 构建预估下一阶段描述
  let forecastStr = '';
  if (pc) {
    const avgYears = pc.avgCycleYears;
    // 根据状态和周期长度估算剩余时间
    if (status === 'bottom' && trendMonths > 0) {
      forecastStr = '预计未来半年可能启动上涨';
    } else if (status === 'falling') {
      // 估算跌的阶段大约占周期的1/3
      const estFallMonths = Math.round(avgYears * 12 / 3);
      const remaining = Math.max(0, estFallMonths - trendMonths);
      if (remaining > 0) {
        forecastStr = `预计还需${remaining > 6 ? `${Math.round(remaining / 2)}-${remaining}个月` : `${remaining}个月左右`}见底`;
      } else {
        forecastStr = '已接近预估底部区域';
      }
    } else if (status === 'rising') {
      forecastStr = '长期趋势未变但短期注意回调风险';
    } else if (status === 'high') {
      forecastStr = '注意回调风险';
    }
  } else {
    // 无预定义周期，给出通用描述
    if (status === 'bottom') {
      forecastStr = '关注放量突破信号确认反转';
    } else if (status === 'falling') {
      forecastStr = '等待底部信号出现';
    } else if (status === 'rising') {
      forecastStr = '关注高位滞涨信号';
    } else if (status === 'high') {
      forecastStr = '注意回调风险';
    }
  }

  // 组装最终描述：当前处于XX阶段，已XX约N个月，预计...
  const parts: string[] = [];
  if (status === 'bottom') {
    parts.push(`当前处于横盘末期`);
  } else {
    parts.push(`当前处于${phaseLabel}`);
  }
  if (durationStr) parts.push(durationStr);
  if (forecastStr) parts.push(forecastStr);

  const signalPart = signals.length > 0 ? `。触发信号：${signals.join('、')}` : '';

  const windowHint =
    analysisWindowYears != null && analysisWindowYears > 0
      ? `参考约${formatAnalysisYearsLabel(analysisWindowYears)}年历史区间。`
      : '';

  return windowHint + parts.join('，') + signalPart;
}

/**
 * Run full bottom signal detection for a stock.
 */
export function detectBottomSignals(stockCode: string, db: Database.Database): BottomSignalResult {
  const fullHistory = getMarketHistoryLastYears(stockCode, db, MAX_HISTORY_YEARS);
  const { windowHistory: history, labelYears } = pickAdaptiveAnalysisWindow(fullHistory, stockCode);

  const signals: string[] = [];

  if (history.length >= 20 && checkPriceLow30(history)) {
    signals.push(formatPriceLowSignalText(labelYears));
  }

  if (history.length >= 60 && checkVolumeShrinkExpand(history)) {
    signals.push('成交量萎缩后放大');
  }

  if (history.length >= 60 && checkRsiOrMacdDivergence(history)) {
    const closes = history.map(r => r.close_price);
    const rsi = calculateRSI(closes, 14);
    if (rsi !== null && rsi < 30) {
      signals.push('RSI低于30超卖');
    }
    if (checkMacdDivergence(closes)) {
      signals.push('MACD底背离');
    }
  }

  const status = determineStatus(history, signals);
  const cycleLength = estimateCycleLength(fullHistory, stockCode);
  const currentPhase = status === 'bottom' ? '底部区域' :
    status === 'falling' ? '下行阶段' :
    status === 'rising' ? '上行阶段' : '高位区域';
  const description = generateDescription(history, status, cycleLength, signals, stockCode, labelYears);

  let rangeMin: number | null = null;
  let rangeMax: number | null = null;
  let anchorPrice: number | null = null;
  if (history.length > 0) {
    const closes = history.map(r => r.close_price);
    rangeMin = Math.min(...closes);
    rangeMax = Math.max(...closes);
    anchorPrice = closes[closes.length - 1];
  }

  return {
    signals,
    status,
    description,
    cycleLength,
    currentPhase,
    analysisWindowYears: labelYears,
    rangeMin,
    rangeMax,
    anchorPrice,
  };
}

// --- CRUD operations ---

/**
 * Get all monitors for a user.
 */
export function getMonitors(userId: number, db?: Database.Database): CycleMonitor[] {
  const database = db || getDatabase();
  const rows = database.prepare(
    `SELECT * FROM cycle_monitors WHERE user_id = ? ORDER BY updated_at DESC`
  ).all(userId);
  return rows.map(row => toResponse(row, database));
}

/**
 * Add a monitor for a stock. Resolves stock name from market_cache or hs300_constituents.
 */
export async function addMonitor(
  userId: number,
  stockCode: string,
  db?: Database.Database,
  /** 前端从搜索选中传入的中文名；纯代码添加时东财 f58 可能为空，避免落库成「代码当名称」 */
  preferredStockName?: string | null
): Promise<CycleMonitor> {
  const database = db || getDatabase();

  // 支持用户输入名称或代码：如果输入不是纯数字，尝试反查代码
  let resolvedCode = stockCode.trim();
  const preferred = (preferredStockName && preferredStockName.trim()) || '';
  let stockName = preferred || resolvedCode;

  if (!/^\d{6}$/.test(resolvedCode)) {
    // 输入的可能是名称，反查代码
    const byName = database.prepare(
      'SELECT stock_code, stock_name FROM market_cache WHERE stock_name = ? LIMIT 1'
    ).get(resolvedCode) as { stock_code: string; stock_name: string } | undefined;
    if (byName) {
      resolvedCode = byName.stock_code;
      stockName = byName.stock_name;
    } else {
      const hs300ByName = database.prepare(
        'SELECT stock_code, stock_name FROM hs300_constituents WHERE stock_name = ? LIMIT 1'
      ).get(stockCode) as { stock_code: string; stock_name: string } | undefined;
      if (hs300ByName) {
        resolvedCode = hs300ByName.stock_code;
        stockName = hs300ByName.stock_name;
      } else {
        const etf = matchPredefinedEtf(resolvedCode);
        if (etf) {
          resolvedCode = etf.code;
          stockName = etf.canonicalName;
        }
      }
    }
  }

  // Check if already exists
  const existing = database.prepare(
    `SELECT id FROM cycle_monitors WHERE user_id = ? AND stock_code = ?`
  ).get(userId, resolvedCode) as { id: number } | undefined;

  if (existing) {
    const row = database.prepare('SELECT * FROM cycle_monitors WHERE id = ?').get(existing.id);
    return toResponse(row, database);
  }

  // 六位代码且未带前端名称时，用本地缓存/沪深300 补全名称
  if (/^\d{6}$/.test(resolvedCode) && !preferred) {
    if (stockName === resolvedCode) {
      const cached = database.prepare(
        'SELECT stock_name FROM market_cache WHERE stock_code = ?'
      ).get(resolvedCode) as { stock_name: string } | undefined;
      if (cached) {
        stockName = cached.stock_name;
      } else {
        const hs300 = database.prepare(
          'SELECT stock_name FROM hs300_constituents WHERE stock_code = ?'
        ).get(resolvedCode) as { stock_name: string } | undefined;
        if (hs300) stockName = hs300.stock_name;
      }
    }
  }

  // 添加时同步拉取近10年日K并落库，再跑周期判断（检测逻辑依赖 market_history，至少需约20个交易日）
  try {
    await fetchAndSaveStockHistory(resolvedCode, 10, database);
  } catch {
    /* 拉取失败仍允许添加，detectBottomSignals 会按已有数据给出说明 */
  }

  // 添加后立即刷新价格，接口失败时使用最近交易日收盘价回退
  try {
    await refreshSingleMonitorPrice(resolvedCode, stockName, database);
  } catch { /* 不阻塞添加流程 */ }

  // 未带前端名称时，行情写入 market_cache 后可能才有正确简称（东财部分 ETF 无 f58）
  if (!preferred) {
    const after = database.prepare(
      'SELECT stock_name FROM market_cache WHERE stock_code = ?'
    ).get(resolvedCode) as { stock_name: string } | undefined;
    if (after?.stock_name && after.stock_name !== resolvedCode) {
      stockName = after.stock_name;
    }
  }

  // Run initial detection
  const result = detectBottomSignals(resolvedCode, database);
  const now = new Date().toISOString();

  const info = database.prepare(
    `INSERT INTO cycle_monitors (user_id, stock_code, stock_name, cycle_length, current_phase, status, description, bottom_signals, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId, resolvedCode, stockName,
    result.cycleLength, result.currentPhase, result.status,
    result.description, JSON.stringify(result.signals), now
  );

  const row = database.prepare('SELECT * FROM cycle_monitors WHERE id = ?').get(info.lastInsertRowid);
  return toResponse(row, database);
}

/**
 * Delete a monitor by id. Returns true if deleted.
 */
export function deleteMonitor(
  userId: number,
  monitorId: number,
  db?: Database.Database
): boolean {
  const database = db || getDatabase();
  const result = database.prepare(
    `DELETE FROM cycle_monitors WHERE id = ? AND user_id = ?`
  ).run(monitorId, userId);
  return result.changes > 0;
}

// --- Bottom signal message creation ---

/**
 * Create cycle_bottom message for all users monitoring a stock that triggered bottom signals.
 */
function createBottomMessages(
  stockCode: string,
  stockName: string,
  currentPrice: number,
  signals: string[],
  min3y: number,
  max3y: number,
  analysisWindowYears: number | null,
  userIds: number[],
  db: Database.Database
): void {
  if (userIds.length === 0) return;

  const bottomRange = `${min3y.toFixed(2)} - ${(min3y + (max3y - min3y) * 0.3).toFixed(2)}`;
  const summary = `${stockName}触发周期底部信号，当前价${currentPrice.toFixed(2)}，预估底部区间${bottomRange}`;
  const detail = JSON.stringify({
    stockCode,
    stockName,
    currentPrice,
    signals,
    bottomRange,
    min3y,
    max3y,
    analysisWindowYears,
  });
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read, created_at)
     VALUES (?, 'cycle_bottom', ?, ?, ?, ?, 0, ?)`
  );

  const insertAll = db.transaction(() => {
    for (const userId of userIds) {
      stmt.run(userId, stockCode, stockName, summary, detail, now);
    }
  });

  insertAll();
}

// --- Fix broken records where stock_code contains name instead of code ---

/**
 * 修复 cycle_monitors 中 stock_code 存了名称而非代码的记录。
 * 启动时调用一次。
 */
function applyResolvedMonitorCode(
  database: Database.Database,
  monitorId: number,
  userId: number,
  oldLabel: string,
  newCode: string,
  newName: string,
  logLine: string
): void {
  const dup = database.prepare(
    `SELECT id FROM cycle_monitors WHERE user_id = ? AND stock_code = ? AND id != ?`
  ).get(userId, newCode, monitorId) as { id: number } | undefined;
  if (dup) {
    database.prepare('DELETE FROM cycle_monitors WHERE id = ?').run(monitorId);
    console.log(`  修复周期监控: 删除重复项 "${oldLabel}"（用户已有 ${newCode}）`);
    return;
  }
  database.prepare('UPDATE cycle_monitors SET stock_code = ?, stock_name = ? WHERE id = ?')
    .run(newCode, newName, monitorId);
  console.log(logLine);
}

export function fixBrokenMonitorCodes(db?: Database.Database): void {
  const database = db || getDatabase();
  const monitors = database.prepare(
    `SELECT id, user_id, stock_code, stock_name FROM cycle_monitors WHERE stock_code NOT GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'`
  ).all() as { id: number; user_id: number; stock_code: string; stock_name: string }[];

  for (const m of monitors) {
    // 尝试从 market_cache 或 hs300_constituents 反查代码
    const byName = database.prepare(
      'SELECT stock_code, stock_name FROM market_cache WHERE stock_name = ? LIMIT 1'
    ).get(m.stock_code) as { stock_code: string; stock_name: string } | undefined;

    if (byName) {
      applyResolvedMonitorCode(
        database,
        m.id,
        m.user_id,
        m.stock_code,
        byName.stock_code,
        byName.stock_name,
        `  修复周期监控: "${m.stock_code}" → ${byName.stock_code}(${byName.stock_name})`
      );
    } else {
      const hs300 = database.prepare(
        'SELECT stock_code, stock_name FROM hs300_constituents WHERE stock_name = ? LIMIT 1'
      ).get(m.stock_code) as { stock_code: string; stock_name: string } | undefined;
      if (hs300) {
        applyResolvedMonitorCode(
          database,
          m.id,
          m.user_id,
          m.stock_code,
          hs300.stock_code,
          hs300.stock_name,
          `  修复周期监控: "${m.stock_code}" → ${hs300.stock_code}(${hs300.stock_name})`
        );
      } else {
        const etf = matchPredefinedEtf(m.stock_code);
        if (etf) {
          applyResolvedMonitorCode(
            database,
            m.id,
            m.user_id,
            m.stock_code,
            etf.code,
            etf.canonicalName,
            `  修复周期监控(ETF映射): "${m.stock_code}" → ${etf.code}(${etf.canonicalName})`
          );
        } else {
          console.log(`  无法修复周期监控: "${m.stock_code}" — 未找到对应代码，删除该记录`);
          database.prepare('DELETE FROM cycle_monitors WHERE id = ?').run(m.id);
        }
      }
    }
  }
}

// --- Daily update ---

/**
 * Update all cycle monitors after market close.
 * For each monitored stock, re-run detection and update DB.
 * If bottom signal newly triggers, create cycle_bottom message.
 */
export function updateAllMonitors(db?: Database.Database): void {
  const database = db || getDatabase();

  // Get all unique stock codes being monitored
  const stocks = database.prepare(
    `SELECT DISTINCT stock_code FROM cycle_monitors`
  ).all() as { stock_code: string }[];

  for (const { stock_code } of stocks) {
    try {
      const result = detectBottomSignals(stock_code, database);
      const now = new Date().toISOString();

      // Get all monitors for this stock to check if bottom is newly triggered
      const monitors = database.prepare(
        `SELECT id, user_id, status, stock_name FROM cycle_monitors WHERE stock_code = ?`
      ).all(stock_code) as { id: number; user_id: number; status: string; stock_name: string }[];

      // Update all monitors for this stock
      const updateStmt = database.prepare(
        `UPDATE cycle_monitors SET cycle_length = ?, current_phase = ?, status = ?,
         description = ?, bottom_signals = ?, updated_at = ? WHERE id = ?`
      );

      const usersToNotify: number[] = [];
      let stockName = stock_code;

      const updateAll = database.transaction(() => {
        for (const monitor of monitors) {
          updateStmt.run(
            result.cycleLength, result.currentPhase, result.status,
            result.description, JSON.stringify(result.signals), now, monitor.id
          );
          stockName = monitor.stock_name;

          // Notify if status changed to 'bottom' (wasn't bottom before)
          if (result.status === 'bottom' && monitor.status !== 'bottom') {
            usersToNotify.push(monitor.user_id);
          }
        }
      });

      updateAll();

      // Create bottom messages if newly triggered
      if (
        usersToNotify.length > 0 &&
        result.anchorPrice != null &&
        result.rangeMin != null &&
        result.rangeMax != null
      ) {
        createBottomMessages(
          stock_code,
          stockName,
          result.anchorPrice,
          result.signals,
          result.rangeMin,
          result.rangeMax,
          result.analysisWindowYears,
          usersToNotify,
          database
        );
      }
    } catch {
      // Single stock failure doesn't affect others
    }
  }
}

/**
 * Refresh latest prices for all monitored stocks.
 * Priority: live quote -> fallback to last trading-day close from history.
 */
export async function refreshAllMonitorPrices(db?: Database.Database): Promise<void> {
  const database = db || getDatabase();
  const stocks = database.prepare(
    `SELECT DISTINCT stock_code, stock_name FROM cycle_monitors`
  ).all() as { stock_code: string; stock_name: string }[];

  for (const stock of stocks) {
    // 仅处理合法6位代码，脏数据由 fixBrokenMonitorCodes 清理
    if (!/^\d{6}$/.test(stock.stock_code)) continue;
    try {
      await refreshSingleMonitorPrice(stock.stock_code, stock.stock_name, database);
    } catch {
      // 单只失败不影响整体刷新
    }
  }
}
