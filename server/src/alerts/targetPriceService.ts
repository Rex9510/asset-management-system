import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { getQuote } from '../market/marketDataService';

// --- Types ---

interface PositionWithUser {
  user_id: number;
  stock_code: string;
  stock_name: string;
}

interface AnalysisRow {
  id: number;
  profit_estimate: string | null;
  space_estimate: string | null;
}

interface MessageRow {
  id: number;
  summary: string;
  created_at: string;
}

export interface TargetPriceAlertResult {
  stockCode: string;
  stockName: string;
  userId: number;
  currentPrice: number;
  targetPrice: number;
  alertType: 'approaching' | 'reached';
  message: string;
}

// --- Duplicate check ---

/**
 * Check if a similar target_price_alert was already sent within the last 24 hours.
 */
function hasRecentAlert(
  userId: number,
  stockCode: string,
  alertType: 'approaching' | 'reached',
  db: Database.Database
): boolean {
  const keyword = alertType === 'approaching' ? '接近目标价' : '到达目标价';
  const row = db.prepare(
    `SELECT id FROM messages
     WHERE user_id = ? AND stock_code = ? AND type = 'target_price_alert'
       AND summary LIKE ? AND created_at > datetime('now', '-24 hours')
     LIMIT 1`
  ).get(userId, stockCode, `%${keyword}%`) as MessageRow | undefined;

  return !!row;
}

// --- Core check function ---

/**
 * Check if a stock's current price has reached or is approaching the target price.
 * If so, insert a message into the messages table.
 *
 * @param stockCode - The stock code to check
 * @param userId - The user who owns the position
 * @param targetPrice - The target price extracted from analysis
 * @param db - Optional database instance
 * @returns The alert result if an alert was generated, null otherwise
 */
export async function checkTargetPrice(
  stockCode: string,
  userId: number,
  targetPrice: number,
  db?: Database.Database
): Promise<TargetPriceAlertResult | null> {
  const database = db || getDatabase();

  if (targetPrice <= 0) return null;

  // Get current market price
  let quote;
  try {
    quote = await getQuote(stockCode, database);
  } catch {
    return null;
  }

  if (!quote || quote.price <= 0) return null;

  const currentPrice = quote.price;
  const stockName = quote.stockName;
  const threshold90 = targetPrice * 0.9;

  let alertType: 'approaching' | 'reached' | null = null;
  let summary = '';
  let detail = '';

  if (currentPrice >= targetPrice) {
    alertType = 'reached';
    summary = `${stockName}(${stockCode}) 到达目标价 ${targetPrice}元，当前价 ${currentPrice}元，可考虑分批出货`;
    detail = JSON.stringify({
      stockCode,
      stockName,
      currentPrice,
      targetPrice,
      alertType: 'reached',
      message: '到达目标价，可考虑分批出货',
    });
  } else if (currentPrice >= threshold90) {
    alertType = 'approaching';
    summary = `${stockName}(${stockCode}) 接近目标价，当前价 ${currentPrice}元，目标价 ${targetPrice}元（已达${((currentPrice / targetPrice) * 100).toFixed(1)}%）`;
    detail = JSON.stringify({
      stockCode,
      stockName,
      currentPrice,
      targetPrice,
      alertType: 'approaching',
      message: '接近目标价',
    });
  }

  if (!alertType) return null;

  // Check for duplicate alerts within 24 hours
  if (hasRecentAlert(userId, stockCode, alertType, database)) {
    return null;
  }

  // Insert message
  database.prepare(
    `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read)
     VALUES (?, 'target_price_alert', ?, ?, ?, ?, 0)`
  ).run(userId, stockCode, stockName, summary, detail);

  return {
    stockCode,
    stockName,
    userId,
    currentPrice,
    targetPrice,
    alertType,
    message: alertType === 'reached'
      ? '到达目标价，可考虑分批出货'
      : '接近目标价',
  };
}

// --- Extract target price from analysis ---

/**
 * Extract target price from analysis profit_estimate or space_estimate fields.
 * These fields may contain JSON with price targets.
 */
export function extractTargetPrice(analysis: AnalysisRow): number | null {
  // Try profit_estimate first
  if (analysis.profit_estimate) {
    const price = parseTargetPriceFromField(analysis.profit_estimate);
    if (price) return price;
  }

  // Fall back to space_estimate
  if (analysis.space_estimate) {
    const price = parseTargetPriceFromField(analysis.space_estimate);
    if (price) return price;
  }

  return null;
}

function parseTargetPriceFromField(field: string): number | null {
  try {
    const parsed = JSON.parse(field);
    // Look for targetPrice, target_price, high, targetPriceHigh
    if (typeof parsed === 'object' && parsed !== null) {
      const candidates = [
        parsed.targetPrice,
        parsed.target_price,
        parsed.targetPriceHigh,
        parsed.high,
        parsed.price,
      ];
      for (const val of candidates) {
        if (typeof val === 'number' && val > 0) return val;
      }
    }
    // If it's a plain number
    if (typeof parsed === 'number' && parsed > 0) return parsed;
  } catch {
    // Try regex for number extraction (e.g., "目标价15.5元")
    const match = field.match(/目标价[位]?\s*[:：]?\s*(\d+(?:\.\d+)?)/);
    if (match) return parseFloat(match[1]);

    // Try "XX元" pattern
    const match2 = field.match(/(\d+(?:\.\d+)?)\s*元/);
    if (match2) return parseFloat(match2[1]);
  }

  return null;
}

// --- Batch check for all users ---

/**
 * Run target price check for all users' positions.
 * For each position, find the latest analysis with a target price,
 * then check if the current price triggers an alert.
 */
export async function runTargetPriceCheck(db?: Database.Database): Promise<TargetPriceAlertResult[]> {
  const database = db || getDatabase();

  // Get all positions with user info
  const positions = database.prepare(
    `SELECT DISTINCT user_id, stock_code, stock_name FROM positions`
  ).all() as PositionWithUser[];

  const results: TargetPriceAlertResult[] = [];

  for (const pos of positions) {
    // Get latest analysis for this stock and user
    const analysis = database.prepare(
      `SELECT id, profit_estimate, space_estimate FROM analyses
       WHERE user_id = ? AND stock_code = ?
       ORDER BY created_at DESC LIMIT 1`
    ).get(pos.user_id, pos.stock_code) as AnalysisRow | undefined;

    if (!analysis) continue;

    const targetPrice = extractTargetPrice(analysis);
    if (!targetPrice) continue;

    try {
      const result = await checkTargetPrice(pos.stock_code, pos.user_id, targetPrice, database);
      if (result) results.push(result);
    } catch {
      // Continue checking other positions
      continue;
    }
  }

  return results;
}
