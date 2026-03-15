import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { Errors } from '../errors/AppError';

// A股代码格式：6位数字，以指定前缀开头
const VALID_STOCK_PREFIXES = [
  '600', '601', '603', '605',
  '000', '001', '002', '003',
  '300', '301',
  '688', '689',
];

const STOCK_CODE_REGEX = /^\d{6}$/;

export interface PositionRow {
  id: number;
  user_id: number;
  stock_code: string;
  stock_name: string;
  cost_price: number;
  shares: number;
  buy_date: string;
  created_at: string;
  updated_at: string;
}

export interface PositionResponse {
  id: number;
  userId: number;
  stockCode: string;
  stockName: string;
  costPrice: number;
  shares: number;
  buyDate: string;
  currentPrice: number | null;
  profitLoss: number | null;
  profitLossPercent: number | null;
  holdingDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePositionInput {
  stockCode: string;
  stockName: string;
  costPrice: number;
  shares: number;
  buyDate: string;
}

export interface UpdatePositionInput {
  costPrice?: number;
  shares?: number;
}

/**
 * Validate A-share stock code format.
 */
export function isValidStockCode(code: string): boolean {
  if (!STOCK_CODE_REGEX.test(code)) return false;
  const prefix3 = code.substring(0, 3);
  return VALID_STOCK_PREFIXES.includes(prefix3);
}

/**
 * Validate date string (YYYY-MM-DD) and ensure it's a real date.
 */
export function isValidDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(date.getTime())) return false;
  // Verify the parsed date matches the input (catches invalid dates like 2024-02-30)
  const [y, m, d] = dateStr.split('-').map(Number);
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
}

/**
 * Calculate holding days: floor of (now - buyDate) in natural days.
 */
export function calculateHoldingDays(buyDate: string): number {
  const buy = new Date(buyDate + 'T00:00:00Z');
  const now = new Date();
  const nowUtcMidnight = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const diffMs = nowUtcMidnight.getTime() - buy.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculate profit/loss amount: (currentPrice - costPrice) * shares
 */
export function calculateProfitLoss(costPrice: number, shares: number, currentPrice: number): number {
  return (currentPrice - costPrice) * shares;
}

/**
 * Calculate profit/loss percentage: (currentPrice - costPrice) / costPrice * 100
 */
export function calculateProfitLossPercent(costPrice: number, currentPrice: number): number {
  return ((currentPrice - costPrice) / costPrice) * 100;
}

function toPositionResponse(row: PositionRow, currentPrice: number | null): PositionResponse {
  return {
    id: row.id,
    userId: row.user_id,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    costPrice: row.cost_price,
    shares: row.shares,
    buyDate: row.buy_date,
    currentPrice,
    profitLoss: currentPrice != null ? calculateProfitLoss(row.cost_price, row.shares, currentPrice) : null,
    profitLossPercent: currentPrice != null ? calculateProfitLossPercent(row.cost_price, currentPrice) : null,
    holdingDays: calculateHoldingDays(row.buy_date),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Try to get current price from market_cache table.
 */
function getCurrentPrice(db: Database.Database, stockCode: string): number | null {
  const row = db.prepare('SELECT price FROM market_cache WHERE stock_code = ?').get(stockCode) as { price: number } | undefined;
  return row ? row.price : null;
}

/**
 * Get all positions for a user.
 */
export function getPositions(userId: number, db?: Database.Database): PositionResponse[] {
  const database = db || getDatabase();
  const rows = database
    .prepare('SELECT * FROM positions WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as PositionRow[];

  return rows.map((row) => {
    const currentPrice = getCurrentPrice(database, row.stock_code);
    return toPositionResponse(row, currentPrice);
  });
}

/**
 * Get a single position by id, scoped to user.
 */
export function getPositionById(id: number, userId: number, db?: Database.Database): PositionResponse | null {
  const database = db || getDatabase();
  const row = database
    .prepare('SELECT * FROM positions WHERE id = ? AND user_id = ?')
    .get(id, userId) as PositionRow | undefined;

  if (!row) return null;

  const currentPrice = getCurrentPrice(database, row.stock_code);
  return toPositionResponse(row, currentPrice);
}

/**
 * Create a new position.
 */
export function createPosition(userId: number, input: CreatePositionInput, db?: Database.Database): PositionResponse {
  const database = db || getDatabase();

  // Validate stock code
  if (!input.stockCode || !isValidStockCode(input.stockCode)) {
    throw Errors.badRequest('股票代码无效，请输入正确的A股代码（6位数字）');
  }

  // Validate stock name
  if (!input.stockName || input.stockName.trim() === '') {
    throw Errors.badRequest('股票名称不能为空');
  }

  // Validate cost price
  if (input.costPrice == null || typeof input.costPrice !== 'number' || input.costPrice <= 0) {
    throw Errors.badRequest('成本价必须为正数');
  }

  // Validate shares
  if (input.shares == null || !Number.isInteger(input.shares) || input.shares <= 0) {
    throw Errors.badRequest('份额必须为正整数');
  }

  // Validate buy date
  if (!input.buyDate || !isValidDate(input.buyDate)) {
    throw Errors.badRequest('买入日期格式无效，请使用YYYY-MM-DD格式');
  }

  const now = new Date().toISOString();
  const result = database
    .prepare(
      `INSERT INTO positions (user_id, stock_code, stock_name, cost_price, shares, buy_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, input.stockCode, input.stockName.trim(), input.costPrice, input.shares, input.buyDate, now, now);

  const id = result.lastInsertRowid as number;
  return getPositionById(id, userId, database)!;
}

/**
 * Update an existing position's cost price and/or shares.
 */
export function updatePosition(id: number, userId: number, input: UpdatePositionInput, db?: Database.Database): PositionResponse {
  const database = db || getDatabase();

  const existing = database
    .prepare('SELECT * FROM positions WHERE id = ? AND user_id = ?')
    .get(id, userId) as PositionRow | undefined;

  if (!existing) {
    throw Errors.notFound('持仓记录不存在');
  }

  // Validate cost price if provided
  if (input.costPrice !== undefined) {
    if (typeof input.costPrice !== 'number' || input.costPrice <= 0) {
      throw Errors.badRequest('成本价必须为正数');
    }
  }

  // Validate shares if provided
  if (input.shares !== undefined) {
    if (!Number.isInteger(input.shares) || input.shares <= 0) {
      throw Errors.badRequest('份额必须为正整数');
    }
  }

  if (input.costPrice === undefined && input.shares === undefined) {
    throw Errors.badRequest('请提供需要更新的字段（成本价或份额）');
  }

  const newCostPrice = input.costPrice ?? existing.cost_price;
  const newShares = input.shares ?? existing.shares;
  const now = new Date().toISOString();

  database
    .prepare('UPDATE positions SET cost_price = ?, shares = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(newCostPrice, newShares, now, id, userId);

  return getPositionById(id, userId, database)!;
}

/**
 * Delete a position.
 */
export function deletePosition(id: number, userId: number, db?: Database.Database): boolean {
  const database = db || getDatabase();

  const result = database
    .prepare('DELETE FROM positions WHERE id = ? AND user_id = ?')
    .run(id, userId);

  if (result.changes === 0) {
    throw Errors.notFound('持仓记录不存在');
  }

  return true;
}
