import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { getSectorFromCode } from '../concentration/concentrationService';
import { isTradingDay, isTradingDayIsoDate } from '../scheduler/tradingDayGuard';

// --- Types ---

export interface ProfitCurvePoint {
  date: string;
  /** 当日持仓总市值 */
  totalValue: number;
  /** 相对成本的浮动盈亏合计（元） */
  totalProfit: number;
  /** 当日持仓总成本 Σ(份额×成本价) */
  totalCost: number;
  /**
   * 持仓加权收益率（%）= totalProfit / totalCost × 100。
   * 用于汇总卡片（相对成本的整体浮盈比例），非「单日涨跌」。
   */
  returnOnCostPct: number;
  /**
   * 较上一快照日总市值涨跌（%）= (当日总市值 − 昨日总市值) / 昨日总市值 × 100。
   * 区间首日为 null（无上一日对比）；有加仓/减仓时市值涨跌会含仓位变动影响。
   */
  dayMvChangePct: number | null;
  /**
   * 较上一快照日浮动盈亏增减（元）= 当日 totalProfit − 昨日 totalProfit。
   * 区间首日为 null。
   */
  dayProfitDelta: number | null;
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

/** 收益曲线辅助信息（与券商 App 对账时可参考） */
export interface ProfitCurveMeta {
  /**
   * 相邻两条快照之间是否存在「中间应有交易日却缺快照」。
   * 为 true 时，日历格内金额为跨多日合并涨跌，与券商逐日口径易不一致。
   */
  hasCalendarGaps: boolean;
}

export interface ChartData {
  profitCurve: ProfitCurvePoint[];
  sectorDistribution: SectorDistItem[];
  stockPnl: StockPnlItem[];
  profitCurveMeta?: ProfitCurveMeta;
}

interface HoldingRow {
  stock_code: string;
  stock_name: string;
  shares: number;
  cost_price: number;
  /** 建仓日；历史补录时仅纳入 buy_date <= 快照日的持仓，避免「晚录入」污染更早曲线 */
  buy_date: string | null;
}

/** ISO 日期字符串比较：仅纳入在 snapshotDate 当日或之前已持有的仓位 */
function filterPositionsForSnapshotDate(positions: HoldingRow[], snapshotDate: string): HoldingRow[] {
  return positions.filter((p) => {
    if (p.buy_date == null || p.buy_date === '') return true;
    return p.buy_date <= snapshotDate;
  });
}

interface MarketCacheRow {
  price: number;
}

// --- Snapshot Recording ---

/**
 * Record daily portfolio snapshot for a single user.
 * For each holding position with a market_cache price, insert a snapshot row.
 * Uses INSERT OR REPLACE to handle re-runs on the same day.
 * 非交易日不写库，避免周末跑刷新脚本或误调时在盈亏日历出现「休市日有快照」。
 */
export function takeSnapshot(userId: number, date: string, db?: Database.Database): void {
  const database = db || getDatabase();

  if (!isTradingDayIsoDate(date)) return;

  const positions = database
    .prepare(
      `SELECT stock_code, stock_name, shares, cost_price, buy_date
       FROM positions
       WHERE user_id = ? AND position_type = 'holding' AND shares > 0
         AND (buy_date IS NULL OR buy_date <= ?)`
    )
    .all(userId, date) as HoldingRow[];

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

/**
 * 删除「快照日期早于该仓 buy_date」的快照行（修正晚录入/旧逻辑污染后应执行，再跑补录）。
 * 仅匹配当前仍存在的持仓记录；已删仓的历史快照不会改动。
 */
export function deleteSnapshotsViolatingBuyDate(db?: Database.Database): number {
  const database = db || getDatabase();
  const result = database
    .prepare(
      `DELETE FROM portfolio_snapshots
       WHERE id IN (
         SELECT ps.id
         FROM portfolio_snapshots ps
         INNER JOIN positions p
           ON p.user_id = ps.user_id
           AND p.stock_code = ps.stock_code
           AND p.position_type = 'holding'
         WHERE p.buy_date IS NOT NULL AND TRIM(p.buy_date) != ''
           AND ps.snapshot_date < p.buy_date
       )`
    )
    .run();
  return result.changes;
}

/** 删除快照日期本身非 A 股交易日的行（含历史误写入的周六日等；保留调休补班日）。 */
export function deleteSnapshotsOnNonTradingDays(db?: Database.Database): number {
  const database = db || getDatabase();
  const rows = database
    .prepare('SELECT DISTINCT snapshot_date FROM portfolio_snapshots ORDER BY snapshot_date')
    .all() as { snapshot_date: string }[];
  let removed = 0;
  for (const { snapshot_date } of rows) {
    if (!isTradingDayIsoDate(snapshot_date)) {
      const r = database.prepare('DELETE FROM portfolio_snapshots WHERE snapshot_date = ?').run(snapshot_date);
      removed += r.changes;
    }
  }
  return removed;
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
    case '365d': return 365;
    default: return 30;
  }
}

/**
 * Get profit curve data per snapshot day: MV, P&L, cost, return on cost,
 * plus day-over-day MV % and P&L delta vs previous snapshot day.
 */
export function getProfitCurve(userId: number, period: string, db?: Database.Database): ProfitCurvePoint[] {
  const database = db || getDatabase();
  const days = periodToDays(period);

  const rows = database
    .prepare(
      `SELECT snapshot_date,
              SUM(market_value) as total_value,
              SUM(profit_loss) as total_profit,
              SUM(shares * cost_price) as total_cost
       FROM portfolio_snapshots
       WHERE user_id = ? AND snapshot_date >= date('now', '-' || ? || ' days')
       GROUP BY snapshot_date
       ORDER BY snapshot_date ASC`
    )
    .all(userId, days) as {
    snapshot_date: string;
    total_value: number;
    total_profit: number;
    total_cost: number;
  }[];

  const base: ProfitCurvePoint[] = rows.map((r) => {
    const totalCost = Number(r.total_cost) || 0;
    const totalProfit = Number(r.total_profit) || 0;
    const returnOnCostPct =
      totalCost > 0 ? Math.round((totalProfit / totalCost) * 10000) / 100 : 0;
    return {
      date: r.snapshot_date,
      totalValue: Number(r.total_value) || 0,
      totalProfit,
      totalCost,
      returnOnCostPct,
      dayMvChangePct: null as number | null,
      dayProfitDelta: null as number | null,
    };
  });

  for (let i = 1; i < base.length; i++) {
    const prev = base[i - 1];
    const curr = base[i];
    const pv = prev.totalValue;
    const cv = curr.totalValue;
    const dayMvChangePct =
      pv > 0 ? Math.round(((cv - pv) / pv) * 10000) / 100 : 0;
    const dayProfitDelta =
      Math.round((curr.totalProfit - prev.totalProfit) * 100) / 100;
    curr.dayMvChangePct = dayMvChangePct;
    curr.dayProfitDelta = dayProfitDelta;
  }

  return base;
}

/**
 * 严格位于 prevDate 之后、currDate 之前的交易日数量（用于检测快照是否按交易日连续）。
 */
export function countTradingDaysExclusiveBetween(prevDate: string, currDate: string): number {
  const cur = new Date(prevDate + 'T12:00:00');
  const end = new Date(currDate + 'T12:00:00');
  let cnt = 0;
  cur.setDate(cur.getDate() + 1);
  while (cur < end) {
    if (isTradingDay(cur)) cnt++;
    cur.setDate(cur.getDate() + 1);
  }
  return cnt;
}

function profitCurveHasCalendarGaps(points: ProfitCurvePoint[]): boolean {
  for (let i = 1; i < points.length; i++) {
    if (countTradingDaysExclusiveBetween(points[i - 1].date, points[i].date) > 0) return true;
  }
  return false;
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
  const profitCurve = getProfitCurve(userId, period, database);
  return {
    profitCurve,
    sectorDistribution: getSectorDistribution(userId, database),
    stockPnl: getStockPnl(userId, database),
    profitCurveMeta: { hasCalendarGaps: profitCurveHasCalendarGaps(profitCurve) },
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

  const held = filterPositionsForSnapshotDate(positions, date);
  for (const pos of held) {
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

    // 当前持仓 + buy_date：补录某日时仅纳入该日及之前已建仓的标的（见 takeHistoricalSnapshot 内过滤）
    const positions = database.prepare(
      `SELECT stock_code, stock_name, shares, cost_price, buy_date
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
