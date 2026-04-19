import Database from 'better-sqlite3';
import axios from 'axios';
import { getDatabase } from '../db/connection';
import { Errors } from '../errors/AppError';
import { logOperation } from '../oplog/operationLogService';
import { ensureStockHistory, fetchAndSaveStockHistory } from '../market/historyService';
import { getQuote } from '../market/marketDataService';

// A股代码格式：6位数字，以指定前缀开头（含沪深常用场内 ETF/LOF，便于中文名搜索命中后不被过滤）
const VALID_STOCK_PREFIXES = [
  '600', '601', '603', '605',
  '000', '001', '002', '003',
  '300', '301',
  '688', '689',
  '501', '502', '505',
  '510', '511', '512', '513', '514', '515', '516', '517', '518', '519',
  '560', '561', '562', '563',
  '588', '589',
  '159', '160', '161', '162', '163', '164', '165', '166', '167', '168', '169',
];

const STOCK_CODE_REGEX = /^\d{6}$/;

/** 将用户输入转为 SQLite LIKE 安全片段（配合 `ESCAPE '!'`：`!%` `!_` `!!` 为字面量） */
function escapeSqlLikePattern(s: string): string {
  return s.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_');
}

export type PositionType = 'holding' | 'watching';

export interface PositionRow {
  id: number;
  user_id: number;
  stock_code: string;
  stock_name: string;
  position_type: PositionType;
  cost_price: number | null;
  shares: number | null;
  buy_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface PositionResponse {
  id: number;
  userId: number;
  stockCode: string;
  stockName: string;
  positionType: PositionType;
  costPrice: number | null;
  shares: number | null;
  buyDate: string | null;
  currentPrice: number | null;
  profitLoss: number | null;
  profitLossPercent: number | null;
  changePercent: number | null;
  holdingDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePositionInput {
  stockCode: string;
  stockName: string;
  positionType?: PositionType;
  costPrice?: number;
  shares?: number;
  buyDate?: string;
}

export interface UpdatePositionInput {
  costPrice?: number;
  shares?: number;
}

export interface StockCandidate {
  stockCode: string;
  stockName: string;
}

/**
 * Validate tradeable 6-digit code (A 股 + 沪深常见场内 ETF/LOF).
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
  const [y, m, d] = dateStr.split('-').map(Number);
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
}

/**
 * Calculate holding days: floor of (now - buyDate) in natural days（自然日，非交易日）.
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

function toPositionResponse(row: PositionRow, marketData: { price: number; changePercent: number } | null): PositionResponse {
  const currentPrice = marketData?.price ?? null;
  const changePercent = marketData?.changePercent ?? null;
  const isHolding = row.position_type === 'holding' && row.cost_price != null && row.shares != null;
  return {
    id: row.id,
    userId: row.user_id,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    positionType: row.position_type,
    costPrice: row.cost_price,
    shares: row.shares,
    buyDate: row.buy_date,
    currentPrice,
    profitLoss: isHolding && currentPrice != null ? calculateProfitLoss(row.cost_price!, row.shares!, currentPrice) : null,
    profitLossPercent: isHolding && currentPrice != null ? calculateProfitLossPercent(row.cost_price!, currentPrice) : null,
    changePercent,
    holdingDays: row.buy_date ? calculateHoldingDays(row.buy_date) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getCurrentPrice(db: Database.Database, stockCode: string): { price: number; changePercent: number } | null {
  const row = db.prepare('SELECT price, change_percent FROM market_cache WHERE stock_code = ?').get(stockCode) as { price: number; change_percent: number } | undefined;
  return row ? { price: row.price, changePercent: row.change_percent } : null;
}

/**
 * Get all positions for a user, optionally filtered by type.
 */
export function getPositions(userId: number, db?: Database.Database, type?: PositionType): PositionResponse[] {
  const database = db || getDatabase();
  let sql = 'SELECT * FROM positions WHERE user_id = ?';
  const params: (number | string)[] = [userId];
  if (type) {
    sql += ' AND position_type = ?';
    params.push(type);
  }
  sql += ' ORDER BY created_at DESC';
  const rows = database.prepare(sql).all(...params) as PositionRow[];
  return rows.map((row) => {
    const marketData = getCurrentPrice(database, row.stock_code);
    return toPositionResponse(row, marketData);
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
  const marketData = getCurrentPrice(database, row.stock_code);
  return toPositionResponse(row, marketData);
}

/**
 * Create a new position (holding or watching).
 */
export async function createPosition(
  userId: number,
  input: CreatePositionInput,
  db?: Database.Database
): Promise<PositionResponse> {
  const database = db || getDatabase();
  const positionType: PositionType = input.positionType || 'holding';

  // Validate stock code
  if (!input.stockCode || !isValidStockCode(input.stockCode)) {
    throw Errors.badRequest('股票代码无效，请输入正确的A股代码（6位数字）');
  }

  // Validate stock name
  if (!input.stockName || input.stockName.trim() === '') {
    throw Errors.badRequest('股票名称不能为空');
  }

  if (positionType === 'holding') {
    // Holding requires cost_price, shares, buy_date
    if (input.costPrice == null || typeof input.costPrice !== 'number' || input.costPrice <= 0) {
      throw Errors.badRequest('成本价必须为正数');
    }
    if (input.shares == null || !Number.isInteger(input.shares) || input.shares <= 0) {
      throw Errors.badRequest('份额必须为正整数');
    }
    if (!input.buyDate || !isValidDate(input.buyDate)) {
      throw Errors.badRequest('买入日期格式无效，请使用YYYY-MM-DD格式');
    }
  }

  const now = new Date().toISOString();
  const costPrice = positionType === 'holding' ? input.costPrice! : (input.costPrice ?? null);
  const shares = positionType === 'holding' ? input.shares! : (input.shares ?? null);
  const buyDate = positionType === 'holding' ? input.buyDate! : (input.buyDate ?? null);

  const result = database
    .prepare(
      `INSERT INTO positions (user_id, stock_code, stock_name, position_type, cost_price, shares, buy_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, input.stockCode, input.stockName.trim(), positionType, costPrice, shares, buyDate, now, now);

  const id = result.lastInsertRowid as number;

  logOperation(
    {
      userId,
      operationType: 'create',
      stockCode: input.stockCode,
      stockName: input.stockName.trim(),
      price: positionType === 'holding' ? costPrice ?? null : null,
      shares: positionType === 'holding' ? shares ?? null : null,
    },
    database
  );

  // 非测试环境：同步等待近10年K线落库 + 行情缓存，并清除估值缓存，避免前端立刻看到「0年数据」
  if (process.env.NODE_ENV !== 'test') {
    try {
      await runPositionBootstrapTask(input.stockCode, database);
    } catch {
      /* 数据补全失败仍返回已创建的持仓 */
    }
  }

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

  if (input.costPrice !== undefined) {
    if (typeof input.costPrice !== 'number' || input.costPrice <= 0) {
      throw Errors.badRequest('成本价必须为正数');
    }
  }

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

  logOperation(
    {
      userId,
      operationType: 'update',
      stockCode: existing.stock_code,
      stockName: existing.stock_name,
      price: newCostPrice ?? null,
      shares: newShares ?? null,
    },
    database
  );

  return getPositionById(id, userId, database)!;
}

/**
 * Delete a position.
 */
export function deletePosition(id: number, userId: number, db?: Database.Database): boolean {
  const database = db || getDatabase();

  const existing = database
    .prepare('SELECT * FROM positions WHERE id = ? AND user_id = ?')
    .get(id, userId) as PositionRow | undefined;

  if (!existing) {
    throw Errors.notFound('持仓记录不存在');
  }

  logOperation(
    {
      userId,
      operationType: 'delete',
      stockCode: existing.stock_code,
      stockName: existing.stock_name,
      price: existing.cost_price ?? null,
      shares: existing.shares ?? null,
    },
    database
  );

  database.prepare('DELETE FROM positions WHERE id = ? AND user_id = ?').run(id, userId);

  return true;
}


/**
 * 计算用户今日收益。
 * 今日收益 = sum(每只持仓股票的 当前价 * 股数 * 涨跌幅 / (100 + 涨跌幅))
 * 即 sum((currentPrice - yesterdayClose) * shares)
 * 其中 yesterdayClose = currentPrice / (1 + changePercent/100)
 */
export function getTodayPnl(userId: number, db?: Database.Database): number {
  const database = db || getDatabase();

  const positions = database.prepare(
    `SELECT p.stock_code, p.shares, mc.price, mc.change_percent
     FROM positions p
     INNER JOIN market_cache mc ON p.stock_code = mc.stock_code
     WHERE p.user_id = ? AND p.position_type = 'holding' AND p.shares > 0`
  ).all(userId) as { stock_code: string; shares: number; price: number; change_percent: number }[];

  let todayPnl = 0;
  for (const p of positions) {
    if (p.price > 0 && p.shares > 0 && p.change_percent != null) {
      const yesterdayClose = p.price / (1 + p.change_percent / 100);
      todayPnl += (p.price - yesterdayClose) * p.shares;
    }
  }

  return Math.round(todayPnl * 100) / 100;
}

/**
 * Search stock candidates by code or name (fuzzy).
 * Merges local cache + remote full-market search, deduplicated by stock_code.
 */
export async function searchStockCandidates(
  keyword: string,
  db?: Database.Database,
  limit: number = 10
): Promise<StockCandidate[]> {
  const database = db || getDatabase();
  const q = keyword.trim();
  if (!q) return [];

  const safeLimit = Math.max(1, Math.min(30, Math.floor(limit)));
  const esc = escapeSqlLikePattern(q);
  const like = `%${esc}%`;
  const prefix = `${esc}%`;
  const likeEsc = " ESCAPE '!'";

  const localRows = database.prepare(
    `SELECT stock_code, stock_name
     FROM (
       SELECT stock_code, stock_name, updated_at as sort_time FROM market_cache
       WHERE stock_code LIKE ?${likeEsc} OR stock_name LIKE ?${likeEsc}
       UNION
       SELECT stock_code, stock_name, updated_at as sort_time FROM hs300_constituents
       WHERE stock_code LIKE ?${likeEsc} OR stock_name LIKE ?${likeEsc}
     )
     GROUP BY stock_code
     ORDER BY stock_code LIKE ?${likeEsc} DESC, stock_name LIKE ?${likeEsc} DESC, sort_time DESC
     LIMIT ?`
  ).all(like, like, like, like, prefix, prefix, safeLimit) as { stock_code: string; stock_name: string }[];

  const merged = new Map<string, StockCandidate>();
  for (const row of localRows) {
    if (!isValidStockCode(row.stock_code)) continue;
    merged.set(row.stock_code, {
      stockCode: row.stock_code,
      stockName: row.stock_name,
    });
  }

  // 远程全市场候选补齐，覆盖“本地未缓存”的大量股票
  if (process.env.NODE_ENV !== 'test') {
    const remoteCandidates = await fetchRemoteStockCandidates(q, safeLimit);
    for (const c of remoteCandidates) {
      if (!merged.has(c.stockCode)) {
        merged.set(c.stockCode, c);
      }
    }
  }

  const candidates = Array.from(merged.values()).slice(0, safeLimit);

  // Fallback: user直接输入合法6位代码时，至少可选择并保存
  if (candidates.length === 0 && isValidStockCode(q)) {
    return [{ stockCode: q, stockName: q }];
  }

  return candidates;
}

const REMOTE_SUGGEST_TTL_MS = 5000;
const REMOTE_SUGGEST_CACHE_MAX = 200;

type RemoteSuggestCacheEntry = { candidates: StockCandidate[]; expiresAt: number };
const remoteSuggestCache = new Map<string, RemoteSuggestCacheEntry>();
const remoteSuggestInflight = new Map<string, Promise<StockCandidate[]>>();

async function fetchRemoteStockCandidates(keyword: string, limit: number): Promise<StockCandidate[]> {
  const cacheKey = `${keyword}\0${limit}`;
  const now = Date.now();
  const hit = remoteSuggestCache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    return [...hit.candidates];
  }

  let inflight = remoteSuggestInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  inflight = (async (): Promise<StockCandidate[]> => {
    try {
      const response = await axios.get('https://searchapi.eastmoney.com/api/suggest/get', {
        params: {
          input: keyword,
          type: 14,
          token: 'D43BF722C8E33BDC906FB84D85E326E8',
          count: Math.max(20, limit),
        },
        timeout: 3500,
      });

      const rows = (response.data?.QuotationCodeTable?.Data || []) as Array<{ Code?: string; Name?: string }>;
      const out: StockCandidate[] = [];
      for (const row of rows) {
        const stockCode = (row.Code || '').trim();
        if (!isValidStockCode(stockCode)) continue;
        out.push({
          stockCode,
          stockName: (row.Name || '').trim() || stockCode,
        });
        if (out.length >= limit) break;
      }

      const snapshot = [...out];
      if (remoteSuggestCache.size >= REMOTE_SUGGEST_CACHE_MAX) {
        const pruneBefore = Date.now();
        for (const [k, v] of remoteSuggestCache) {
          if (v.expiresAt <= pruneBefore) remoteSuggestCache.delete(k);
        }
        while (remoteSuggestCache.size >= REMOTE_SUGGEST_CACHE_MAX) {
          const first = remoteSuggestCache.keys().next().value;
          if (first === undefined) break;
          remoteSuggestCache.delete(first);
        }
      }
      remoteSuggestCache.set(cacheKey, { candidates: snapshot, expiresAt: Date.now() + REMOTE_SUGGEST_TTL_MS });
      return snapshot;
    } catch {
      return [];
    } finally {
      remoteSuggestInflight.delete(cacheKey);
    }
  })();

  remoteSuggestInflight.set(cacheKey, inflight);
  return inflight;
}

async function runPositionBootstrapTask(stockCode: string, db: Database.Database): Promise<void> {
  const pureCode = stockCode.replace(/\.\w+$/, '');
  if (!isValidStockCode(pureCode)) return;

  try {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM market_history WHERE stock_code = ?').get(pureCode) as { cnt: number };
    if (!row.cnt || row.cnt < 1200) {
      await fetchAndSaveStockHistory(pureCode, 10, db);
    } else {
      await ensureStockHistory(pureCode, db);
    }
  } catch {
    // 历史数据失败不阻断
  }

  try {
    await getQuote(pureCode, db);
  } catch {
    // 最新行情失败不阻断
  }

  try {
    db.prepare('DELETE FROM valuation_cache WHERE stock_code = ?').run(pureCode);
  } catch {
    /* 无表或删除失败忽略 */
  }
}
