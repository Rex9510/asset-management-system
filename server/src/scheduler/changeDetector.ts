import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';

/**
 * 变化触发制过滤器
 * 
 * 降本优化核心模块：检测股票价格和RSI变化，
 * 变化不大时跳过AI调用，复用上次分析结果。
 * 
 * 规则：股价变化 < 2% 且 RSI变化 < 5 → 跳过AI调用
 */

interface ChangeSnapshot {
  stockCode: string;
  price: number;
  rsi: number;
  updatedAt: string;
}

// In-memory cache for last analysis snapshots
const snapshotCache = new Map<string, ChangeSnapshot>();

/**
 * 初始化快照缓存（从数据库加载最近分析时的价格和RSI）
 */
export function initSnapshotCache(db?: Database.Database): void {
  const database = db || getDatabase();
  try {
    // Load latest analysis for each stock with indicator data
    const rows = database.prepare(`
      SELECT a.stock_code, a.created_at,
             mc.price as last_price
      FROM analyses a
      INNER JOIN (
        SELECT stock_code, MAX(created_at) as max_created
        FROM analyses
        GROUP BY stock_code
      ) latest ON a.stock_code = latest.stock_code AND a.created_at = latest.max_created
      LEFT JOIN market_cache mc ON a.stock_code = mc.stock_code
    `).all() as { stock_code: string; created_at: string; last_price: number | null }[];

    for (const row of rows) {
      if (row.last_price != null) {
        snapshotCache.set(row.stock_code, {
          stockCode: row.stock_code,
          price: row.last_price,
          rsi: 50, // Default RSI, will be updated on first real check
          updatedAt: row.created_at,
        });
      }
    }
  } catch {
    // Cache init failure is non-critical
  }
}

/**
 * 检测股票是否有足够变化需要重新分析
 * 
 * @returns true = 有变化，需要AI分析; false = 变化不大，跳过AI
 */
export function hasSignificantChange(
  stockCode: string,
  currentPrice: number,
  currentRsi: number | null
): boolean {
  const snapshot = snapshotCache.get(stockCode);

  // No previous snapshot = first time analysis, always run
  if (!snapshot) return true;

  // Calculate price change percentage
  const priceChange = Math.abs((currentPrice - snapshot.price) / snapshot.price) * 100;

  // Calculate RSI change (use 0 if RSI unavailable)
  const rsiChange = currentRsi != null ? Math.abs(currentRsi - snapshot.rsi) : 0;

  // Rule: price change < 2% AND RSI change < 5 → skip AI
  if (priceChange < 2 && rsiChange < 5) {
    return false;
  }

  return true;
}

/**
 * 更新快照缓存（分析完成后调用）
 */
export function updateSnapshot(
  stockCode: string,
  price: number,
  rsi: number | null
): void {
  snapshotCache.set(stockCode, {
    stockCode,
    price,
    rsi: rsi ?? 50,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * 获取快照（用于测试）
 */
export function getSnapshot(stockCode: string): ChangeSnapshot | undefined {
  return snapshotCache.get(stockCode);
}

/**
 * 清空快照缓存（用于测试）
 */
export function clearSnapshotCache(): void {
  snapshotCache.clear();
}
