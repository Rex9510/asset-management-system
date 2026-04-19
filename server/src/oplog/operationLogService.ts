import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';

// --- Types ---

export interface LogOperationInput {
  userId: number;
  operationType: 'create' | 'update' | 'delete';
  stockCode: string;
  stockName: string;
  /** 缺失时写入 NULL（如自选、删除前无成本） */
  price?: number | null;
  shares?: number | null;
  aiSummary?: string;
}

export interface OperationLog {
  id: number;
  user_id: number;
  operation_type: string;
  stock_code: string;
  stock_name: string;
  price: number | null;
  shares: number | null;
  ai_summary: string | null;
  review_7d: string | null;
  review_7d_at: string | null;
  review_30d: string | null;
  review_30d_at: string | null;
  created_at: string;
}

// --- Service functions ---

/**
 * Insert a new operation log record.
 */
export function logOperation(params: LogOperationInput, db?: Database.Database): void {
  const database = db || getDatabase();
  database
    .prepare(
      `INSERT INTO operation_logs (user_id, operation_type, stock_code, stock_name, price, shares, ai_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.userId,
      params.operationType,
      params.stockCode,
      params.stockName,
      params.price ?? null,
      params.shares ?? null,
      params.aiSummary ?? null
    );
}


/**
 * Get paginated operation logs for a user, ordered by created_at DESC.
 */
export function getOperationLogs(
  userId: number,
  page: number,
  limit: number,
  db?: Database.Database
): { logs: OperationLog[]; total: number } {
  const database = db || getDatabase();

  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const offset = (safePage - 1) * safeLimit;

  const { total } = database
    .prepare('SELECT COUNT(*) as total FROM operation_logs WHERE user_id = ?')
    .get(userId) as { total: number };

  const logs = database
    .prepare(
      `SELECT * FROM operation_logs WHERE user_id = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(userId, safeLimit, offset) as OperationLog[];

  return { logs, total };
}

/**
 * Generate 7d and 30d review text for eligible operation logs.
 *
 * Pure rule-based: compares operation-time price with current market price,
 * generates neutral template text with no criticism or blame.
 */
export function generateReviews(db?: Database.Database): void {
  const database = db || getDatabase();

  // Find logs needing 7d review
  const need7d = database
    .prepare(
      `SELECT * FROM operation_logs
       WHERE review_7d IS NULL
         AND price IS NOT NULL
         AND created_at <= datetime('now', '-7 days')`
    )
    .all() as OperationLog[];

  // Find logs needing 30d review
  const need30d = database
    .prepare(
      `SELECT * FROM operation_logs
       WHERE review_30d IS NULL
         AND price IS NOT NULL
         AND created_at <= datetime('now', '-30 days')`
    )
    .all() as OperationLog[];

  const update7d = database.prepare(
    `UPDATE operation_logs SET review_7d = ?, review_7d_at = datetime('now') WHERE id = ?`
  );

  const update30d = database.prepare(
    `UPDATE operation_logs SET review_30d = ?, review_30d_at = datetime('now') WHERE id = ?`
  );

  for (const log of need7d) {
    const reviewText = buildReviewText(database, log, 7);
    update7d.run(reviewText, log.id);
  }

  for (const log of need30d) {
    const reviewText = buildReviewText(database, log, 30);
    update30d.run(reviewText, log.id);
  }
}

/**
 * Build neutral review text comparing operation price with current price.
 */
function buildReviewText(
  database: Database.Database,
  log: OperationLog,
  days: number
): string {
  const cache = database
    .prepare('SELECT price FROM market_cache WHERE stock_code = ?')
    .get(log.stock_code) as { price: number } | undefined;

  if (!cache) {
    return '暂无最新行情数据';
  }

  const opPrice = log.price!;
  const currentPrice = cache.price;
  const changePct = ((currentPrice - opPrice) / opPrice) * 100;

  return `操作后${days}天，${log.stock_name}价格从${opPrice}元变为${currentPrice}元，涨跌幅${changePct.toFixed(2)}%`;
}

/**
 * Return logs that have at least one review (review_7d or review_30d not null).
 */
export function getReviews(userId: number, db?: Database.Database): OperationLog[] {
  const database = db || getDatabase();

  return database
    .prepare(
      `SELECT * FROM operation_logs
       WHERE user_id = ?
         AND (review_7d IS NOT NULL OR review_30d IS NOT NULL)
       ORDER BY created_at DESC`
    )
    .all(userId) as OperationLog[];
}
