import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { getSectorFromCode } from '../concentration/concentrationService';
import { isTradingDay } from '../scheduler/tradingDayGuard';

// --- Types ---

export interface ProfitCurvePoint {
  date: string;
  totalValue: number;
  totalProfit: number;
}

export interface SectorDistItem {
  sector: string;
  value: number;
  percentage: number;
}

export interface StockPnlItem {
  stockCode: string;
  stockName: string;
  profitLoss: number;
  marketValue: number;
}

export interface ChartData {
  profitCurve: ProfitCurvePoint[];
  sectorDistribution: SectorDistItem[];
  stockPnl: StockPnlItem[];
}

interface HoldingRow {
  stock_code: string;
  stock_name: string;
  shares: number;
  cost_price: number;
}

interface MarketCacheRow {
  price: number;
}

// --- Snapshot Recording ---

/**
 * Record daily portfolio snapshot for a single user.
 * For each holding position with a market_cache price, insert a snapshot row.
 * Uses INSERT OR REPLACE to handle re-runs on the same day.
 */
export function takeSnapshot(userId: number, date: string, db?: Database.Database): void {
  const database = db || getDatabase();

  const positions = database
    .prepare(
      `SELECT stock_code, stock_name, shares, cost_price
       FROM positions
       WHERE user_id = ? AND position_type = 'holding' AND shares > 0`
    )
    .all(userId) as HoldingRow[];

  if (positions.length === 0) return;

  const insertStmt = database.prepare(
    `INSERT OR REPLACE INTO portfolio_snapshots
       (user_id, snapshot_date, stock_code, stock_name, shares, cost_price, market_price, market_value, profit_loss, sector)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const pos of positions) {
    const cache = database
      .prepare('SELECT price FROM market_cache WHERE stock_code = ?')
      .get(pos.stock_code) as MarketCacheRow | undefined;

    if (!cache) continue;

    const marketPrice = cache.price;
    const marketValue = pos.shares * marketPrice;
    const profitLoss = marketValue - pos.shares * pos.cost_price;
    const sector = getSectorFromCode(pos.stock_code);

    insertStmt.run(
      userId,
      date,
      pos.stock_code,
      pos.stock_name,
      pos.shares,
      pos.cost_price,
      marketPrice,
      marketValue,
      profitLoss,
      sector
    );
  }
}


/**
 * Record daily portfolio snapshot for ALL users with holding positions.
 */
export function takeAllUsersSnapshot(date: string, db?: Database.Database): void {
  const database = db || getDatabase();

  const users = database
    .prepare(
      `SELECT DISTINCT user_id FROM positions WHERE position_type = 'holding' AND shares > 0`
    )
    .all() as { user_id: number }[];

  for (const { user_id } of users) {
    takeSnapshot(user_id, date, database);
  }
}

// --- Chart Data Aggregation ---

/**
 * Parse period string to number of days.
 */
function periodToDays(period: string): number {
  switch (period) {
    case '7d': return 7;
    case '30d': return 30;
    case '90d': return 90;
    default: return 30;
  }
}

/**
 * Get profit curve data: totalValue and totalProfit per day over a period.
 */
export function getProfitCurve(userId: number, period: string, db?: Database.Database): ProfitCurvePoint[] {
  const database = db || getDatabase();
  const days = periodToDays(period);

  const rows = database
    .prepare(
      `SELECT snapshot_date, SUM(market_value) as total_value, SUM(profit_loss) as total_profit
       FROM portfolio_snapshots
       WHERE user_id = ? AND snapshot_date >= date('now', '-' || ? || ' days')
       GROUP BY snapshot_date
       ORDER BY snapshot_date ASC`
    )
    .all(userId, days) as { snapshot_date: string; total_value: number; total_profit: number }[];

  return rows.map((r) => ({
    date: r.snapshot_date,
    totalValue: r.total_value,
    totalProfit: r.total_profit,
  }));
}

/**
 * Get sector distribution from the latest snapshot date.
 */
export function getSectorDistribution(userId: number, db?: Database.Database): SectorDistItem[] {
  const database = db || getDatabase();

  const latestRow = database
    .prepare(
      `SELECT snapshot_date FROM portfolio_snapshots WHERE user_id = ? ORDER BY snapshot_date DESC LIMIT 1`
    )
    .get(userId) as { snapshot_date: string } | undefined;

  if (!latestRow) return [];

  const rows = database
    .prepare(
      `SELECT sector, SUM(market_value) as value
       FROM portfolio_snapshots
       WHERE user_id = ? AND snapshot_date = ?
       GROUP BY sector
       ORDER BY value DESC`
    )
    .all(userId, latestRow.snapshot_date) as { sector: string | null; value: number }[];

  const totalValue = rows.reduce((sum, r) => sum + r.value, 0);
  if (totalValue === 0) return [];

  return rows.map((r) => ({
    sector: r.sector || '其他',
    value: r.value,
    percentage: (r.value / totalValue) * 100,
  }));
}

/**
 * Get per-stock PnL from the latest snapshot date, sorted descending by profitLoss.
 */
export function getStockPnl(userId: number, db?: Database.Database): StockPnlItem[] {
  const database = db || getDatabase();

  const latestRow = database
    .prepare(
      `SELECT snapshot_date FROM portfolio_snapshots WHERE user_id = ? ORDER BY snapshot_date DESC LIMIT 1`
    )
    .get(userId) as { snapshot_date: string } | undefined;

  if (!latestRow) return [];

  const rows = database
    .prepare(
      `SELECT stock_code, stock_name, profit_loss, market_value
       FROM portfolio_snapshots
       WHERE user_id = ? AND snapshot_date = ?
       ORDER BY profit_loss DESC`
    )
    .all(userId, latestRow.snapshot_date) as { stock_code: string; stock_name: string; profit_loss: number; market_value: number }[];

  return rows.map((r) => ({
    stockCode: r.stock_code,
    stockName: r.stock_name,
    profitLoss: r.profit_loss,
    marketValue: r.market_value,
  }));
}

/**
 * Convenience function: get all chart data at once.
 */
export function getChartData(userId: number, period: string, db?: Database.Database): ChartData {
  const database = db || getDatabase();
  return {
    profitCurve: getProfitCurve(userId, period, database),
    sectorDistribution: getSectorDistribution(userId, database),
    stockPnl: getStockPnl(userId, database),
  };
}


// --- Snapshot Backfill ---

/**
 * Take snapshot for a specific historical date using market_history close prices.
 * Falls back to market_cache if no history available for that date.
 */
function takeHistoricalSnapshot(
  userId: number,
  date: string,
  positions: HoldingRow[],
  db: Database.Database
): number {
  let count = 0;
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO portfolio_snapshots
       (user_id, snapshot_date, stock_code, stock_name, shares, cost_price, market_price, market_value, profit_loss, sector)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const pos of positions) {
    // Try market_history close price for that date
    let marketPrice: number | null = null;

    const histRow = db.prepare(
      'SELECT close_price FROM market_history WHERE stock_code = ? AND trade_date = ?'
    ).get(pos.stock_code, date) as { close_price: number } | undefined;

    if (histRow) {
      marketPrice = histRow.close_price;
    } else {
      // Fallback: find closest earlier date
      const closestRow = db.prepare(
        'SELECT close_price FROM market_history WHERE stock_code = ? AND trade_date <= ? ORDER BY trade_date DESC LIMIT 1'
      ).get(pos.stock_code, date) as { close_price: number } | undefined;

      if (closestRow) {
        marketPrice = closestRow.close_price;
      } else {
        // Last resort: use market_cache current price
        const cacheRow = db.prepare(
          'SELECT price FROM market_cache WHERE stock_code = ?'
        ).get(pos.stock_code) as MarketCacheRow | undefined;
        if (cacheRow) marketPrice = cacheRow.price;
      }
    }

    if (marketPrice === null) continue;

    const marketValue = pos.shares * marketPrice;
    const profitLoss = marketValue - pos.shares * pos.cost_price;
    const sector = getSectorFromCode(pos.stock_code);

    const result = insertStmt.run(
      userId, date, pos.stock_code, pos.stock_name,
      pos.shares, pos.cost_price, marketPrice, marketValue, profitLoss, sector
    );
    if (result.changes > 0) count++;
  }

  return count;
}

/**
 * Generate list of trading days between startDate and endDate (inclusive).
 */
function getTradingDaysBetween(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const current = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  while (current <= end) {
    if (isTradingDay(current)) {
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const d = String(current.getDate()).padStart(2, '0');
      days.push(`${y}-${m}-${d}`);
    }
    current.setDate(current.getDate() + 1);
  }

  return days;
}

/**
 * 启动时自动补录缺失的持仓快照。
 *
 * 逻辑：
 * 1. 遍历所有有持仓的用户
 * 2. 从用户注册日期（或首次持仓日期）开始，到今天为止
 * 3. 找出所有交易日中缺失快照的日期
 * 4. 用 market_history 的收盘价补录快照
 *
 * 这样即使服务器停了几天，重启后收益曲线也能自动补全。
 */
export function backfillMissingSnapshots(db?: Database.Database): void {
  const database = db || getDatabase();
  const today = new Date().toISOString().slice(0, 10);

  // Get all users with holding positions
  const users = database.prepare(
    `SELECT DISTINCT p.user_id, u.created_at
     FROM positions p
     INNER JOIN users u ON p.user_id = u.id
     WHERE p.position_type = 'holding' AND p.shares > 0`
  ).all() as { user_id: number; created_at: string }[];

  let totalBackfilled = 0;

  for (const { user_id, created_at } of users) {
    // Start date: user registration date (just the date part)
    const startDate = (created_at || today).slice(0, 10);

    // Get existing snapshot dates for this user
    const existingDates = new Set(
      (database.prepare(
        'SELECT DISTINCT snapshot_date FROM portfolio_snapshots WHERE user_id = ?'
      ).all(user_id) as { snapshot_date: string }[]).map(r => r.snapshot_date)
    );

    // Get all trading days from registration to today
    const tradingDays = getTradingDaysBetween(startDate, today);

    // Find missing days
    const missingDays = tradingDays.filter(d => !existingDates.has(d));

    if (missingDays.length === 0) continue;

    // Get user's current holdings (we use current holdings for backfill —
    // this is an approximation since we don't track historical position changes)
    const positions = database.prepare(
      `SELECT stock_code, stock_name, shares, cost_price
       FROM positions
       WHERE user_id = ? AND position_type = 'holding' AND shares > 0`
    ).all(user_id) as HoldingRow[];

    if (positions.length === 0) continue;

    // Backfill in a transaction for performance
    const backfill = database.transaction(() => {
      for (const date of missingDays) {
        totalBackfilled += takeHistoricalSnapshot(user_id, date, positions, database);
      }
    });

    backfill();

    if (missingDays.length > 0) {
      console.log(`  用户${user_id}: 补录${missingDays.length}个交易日快照`);
    }
  }

  if (totalBackfilled > 0) {
    console.log(`快照补录完成: 共补录${totalBackfilled}条记录`);
  }
}
