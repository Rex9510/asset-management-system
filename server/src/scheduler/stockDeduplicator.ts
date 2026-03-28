import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';

/**
 * 股票去重池
 * 
 * 降本优化核心模块：多用户持有同一股票时只分析一次，结果共享。
 * 24h未登录用户跳过定时分析。
 */

interface StockHolder {
  user_id: number;
  stock_code: string;
  stock_name: string;
}

interface DeduplicatedStock {
  stockCode: string;
  stockName: string;
  holderUserIds: number[];
}

/**
 * 获取去重后的活跃用户持仓股票列表
 * 
 * 1. 过滤24h未登录用户
 * 2. 同一股票多用户只保留一条，记录所有持有者userId
 */
export function getDeduplicatedStocks(db?: Database.Database): DeduplicatedStock[] {
  const database = db || getDatabase();

  // Get active users (logged in within 24h)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const rows = database.prepare(`
    SELECT p.user_id, p.stock_code, p.stock_name
    FROM positions p
    INNER JOIN users u ON p.user_id = u.id
    WHERE u.last_login_at >= ? OR u.last_login_at IS NULL
    ORDER BY p.stock_code
  `).all(cutoff) as StockHolder[];

  // Deduplicate by stock_code
  const stockMap = new Map<string, DeduplicatedStock>();

  for (const row of rows) {
    const existing = stockMap.get(row.stock_code);
    if (existing) {
      if (!existing.holderUserIds.includes(row.user_id)) {
        existing.holderUserIds.push(row.user_id);
      }
    } else {
      stockMap.set(row.stock_code, {
        stockCode: row.stock_code,
        stockName: row.stock_name,
        holderUserIds: [row.user_id],
      });
    }
  }

  return Array.from(stockMap.values());
}

/**
 * 将分析结果分发给所有持有该股票的用户
 */
export function distributeAnalysisToHolders(
  stockCode: string,
  stockName: string,
  holderUserIds: number[],
  analysisId: number,
  summary: string,
  detail: string,
  messageType: string,
  db?: Database.Database
): void {
  const database = db || getDatabase();
  const now = new Date().toISOString();

  const stmt = database.prepare(`
    INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, analysis_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const userId of holderUserIds) {
    try {
      stmt.run(userId, messageType, stockCode, stockName, summary, detail, analysisId, now);
    } catch {
      // Individual message creation failure is non-critical
    }
  }
}
