/**
 * 每日关注追踪服务
 *
 * 纯规则引擎，零AI调用。
 * 自动追踪历史每日关注在推荐后 3/7/14/30 天的实际涨跌幅。
 * 收益率 = (追踪日价格 - 推荐价格) / 推荐价格 × 100%
 * 追踪节点到达时创建 daily_pick_tracking 消息。
 */
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { getQuote } from '../market/marketDataService';

// --- Types ---

export interface TrackingRecord {
  pickId: number;
  stockCode: string;
  stockName: string;
  pickDate: string;
  pickPrice: number;
  trackingDays: number;
  currentPrice: number;
  returnPercent: number;
  status: 'profit' | 'loss';
}

export interface AccuracyStats {
  totalPicks: number;
  profitCount: number;
  lossCount: number;
  avgReturn: number;
  winRate: number;
}

// --- Constants ---

const TRACKING_INTERVALS = [3, 7, 14, 30];

// --- Helpers ---


/**
 * Get current price for a stock. Tries market_cache first, then getQuote().
 */
async function getCurrentPrice(
  stockCode: string,
  db: Database.Database
): Promise<number | null> {
  // Primary: market_cache table
  const cached = db.prepare(
    'SELECT price FROM market_cache WHERE stock_code = ?'
  ).get(stockCode) as { price: number } | undefined;

  if (cached && cached.price > 0) {
    return cached.price;
  }

  // Fallback: getQuote API
  try {
    const quote = await getQuote(stockCode, db);
    return quote.price;
  } catch {
    return null;
  }
}

/**
 * Calculate return percent: (trackedPrice - pickPrice) / pickPrice * 100
 */
export function calculateReturn(trackedPrice: number, pickPrice: number): number {
  if (pickPrice === 0) return 0;
  return Math.round(((trackedPrice - pickPrice) / pickPrice) * 10000) / 100;
}

// --- Core functions ---

/**
 * Main tracking function — called by scheduler after market close.
 * Finds all daily_pick messages that need tracking at 3/7/14/30 day nodes,
 * gets current prices, calculates returns, saves to DB, creates messages.
 */
export async function trackDailyPicks(db?: Database.Database): Promise<void> {
  const database = db || getDatabase();
  const today = new Date().toISOString().slice(0, 10);

  for (const trackingDays of TRACKING_INTERVALS) {
    // Find daily_pick messages where:
    // - created_at date + trackingDays <= today
    // - No existing record in daily_pick_tracking for (message.id, trackingDays)
    const pendingPicks = database.prepare(`
      SELECT m.id, m.stock_code, m.stock_name, m.detail,
             DATE(m.created_at) as pick_date, m.user_id
      FROM messages m
      WHERE m.type = 'daily_pick'
        AND DATE(m.created_at, '+' || ? || ' days') <= ?
        AND NOT EXISTS (
          SELECT 1 FROM daily_pick_tracking dpt
          WHERE dpt.pick_message_id = m.id AND dpt.tracking_days = ?
        )
    `).all(trackingDays, today, trackingDays) as {
      id: number;
      stock_code: string;
      stock_name: string;
      detail: string;
      pick_date: string;
      user_id: number;
    }[];

    for (const pick of pendingPicks) {
      // Parse detail JSON to get pickPrice (currentPrice at time of pick)
      let pickPrice: number;
      let stockCode: string;
      let stockName: string;

      try {
        const detail = JSON.parse(pick.detail);
        // The detail may have currentPrice directly, or targetPriceRange with latestClose
        pickPrice = detail.currentPrice
          ?? detail.targetPriceRange?.low
          ?? detail.latestClose
          ?? 0;
        stockCode = detail.stockCode || pick.stock_code;
        stockName = detail.stockName || pick.stock_name;
      } catch {
        stockCode = pick.stock_code;
        stockName = pick.stock_name;
        pickPrice = 0;
      }

      if (pickPrice <= 0) continue;

      // Get current market price
      const currentPrice = await getCurrentPrice(stockCode, database);
      if (currentPrice === null || currentPrice <= 0) continue;

      const returnPercent = calculateReturn(currentPrice, pickPrice);
      const now = new Date().toISOString();

      // Insert tracking record
      database.prepare(`
        INSERT INTO daily_pick_tracking
          (pick_message_id, stock_code, stock_name, pick_date, pick_price,
           tracking_days, tracked_price, return_percent, tracked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pick.id, stockCode, stockName, pick.pick_date, pickPrice,
        trackingDays, currentPrice, returnPercent, now
      );

      // Create daily_pick_tracking message for the user
      const status = returnPercent > 0 ? '盈利' : '亏损';
      const summary = `${stockName} ${trackingDays}天追踪：${status} ${Math.abs(returnPercent).toFixed(2)}%`;
      const msgDetail = JSON.stringify({
        pickMessageId: pick.id,
        stockCode,
        stockName,
        pickDate: pick.pick_date,
        pickPrice,
        trackingDays,
        trackedPrice: currentPrice,
        returnPercent,
        status: returnPercent > 0 ? 'profit' : 'loss',
      });

      database.prepare(`
        INSERT INTO messages
          (user_id, type, stock_code, stock_name, summary, detail, is_read, created_at)
        VALUES (?, 'daily_pick_tracking', ?, ?, ?, ?, 0, ?)
      `).run(pick.user_id, stockCode, stockName, summary, msgDetail, now);
    }
  }
}

/**
 * Get all tracking records with current status, sorted by tracked_at DESC.
 */
export function getTrackingList(db?: Database.Database): TrackingRecord[] {
  const database = db || getDatabase();

  const rows = database.prepare(`
    SELECT pick_message_id, stock_code, stock_name, pick_date, pick_price,
           tracking_days, tracked_price, return_percent, tracked_at
    FROM daily_pick_tracking
    WHERE tracked_price IS NOT NULL
    ORDER BY tracked_at DESC
  `).all() as {
    pick_message_id: number;
    stock_code: string;
    stock_name: string;
    pick_date: string;
    pick_price: number;
    tracking_days: number;
    tracked_price: number;
    return_percent: number;
    tracked_at: string;
  }[];

  return rows.map(r => ({
    pickId: r.pick_message_id,
    stockCode: r.stock_code,
    stockName: r.stock_name,
    pickDate: r.pick_date,
    pickPrice: r.pick_price,
    trackingDays: r.tracking_days,
    currentPrice: r.tracked_price,
    returnPercent: r.return_percent,
    status: r.return_percent > 0 ? 'profit' as const : 'loss' as const,
  }));
}

/**
 * Calculate accuracy statistics from completed tracking records.
 * - totalPicks = count of unique pick_message_ids with at least one completed tracking
 * - profitCount = picks where latest tracking return > 0
 * - lossCount = picks where latest tracking return <= 0
 * - avgReturn = arithmetic mean of all return_percent values
 * - winRate = profitCount / totalPicks
 */
export function getAccuracyStats(db?: Database.Database): AccuracyStats {
  const database = db || getDatabase();

  // Get all completed tracking records
  const allReturns = database.prepare(`
    SELECT return_percent FROM daily_pick_tracking
    WHERE tracked_price IS NOT NULL
  `).all() as { return_percent: number }[];

  // Get latest tracking per pick (highest tracking_days with completed data)
  const latestPerPick = database.prepare(`
    SELECT pick_message_id, return_percent
    FROM daily_pick_tracking t1
    WHERE tracked_price IS NOT NULL
      AND tracking_days = (
        SELECT MAX(t2.tracking_days)
        FROM daily_pick_tracking t2
        WHERE t2.pick_message_id = t1.pick_message_id
          AND t2.tracked_price IS NOT NULL
      )
    GROUP BY pick_message_id
  `).all() as { pick_message_id: number; return_percent: number }[];

  const totalPicks = latestPerPick.length;

  if (totalPicks === 0) {
    return { totalPicks: 0, profitCount: 0, lossCount: 0, avgReturn: 0, winRate: 0 };
  }

  const profitCount = latestPerPick.filter(r => r.return_percent > 0).length;
  const lossCount = latestPerPick.filter(r => r.return_percent <= 0).length;

  // avgReturn = arithmetic mean of ALL return_percent values
  const avgReturn = allReturns.length > 0
    ? Math.round(allReturns.reduce((sum, r) => sum + r.return_percent, 0) / allReturns.length * 100) / 100
    : 0;

  const winRate = Math.round((profitCount / totalPicks) * 10000) / 10000;

  return { totalPicks, profitCount, lossCount, avgReturn, winRate };
}
