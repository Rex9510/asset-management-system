import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  takeSnapshot,
  takeAllUsersSnapshot,
  getProfitCurve,
  getSectorDistribution,
  getStockPnl,
  getChartData,
  countTradingDaysExclusiveBetween,
  deleteSnapshotsViolatingBuyDate,
  deleteSnapshotsOnNonTradingDays,
} from './snapshotService';

let testDb: Database.Database;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function insertUser(db: Database.Database, userId: number): void {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(userId, `user${userId}`, 'hash');
}

function insertPosition(
  db: Database.Database,
  userId: number,
  stockCode: string,
  stockName: string,
  shares: number,
  costPrice: number = 10.0,
  positionType: string = 'holding'
): void {
  db.prepare(
    `INSERT INTO positions (user_id, stock_code, stock_name, position_type, cost_price, shares, buy_date)
     VALUES (?, ?, ?, ?, ?, ?, '2024-01-01')`
  ).run(userId, stockCode, stockName, positionType, costPrice, shares);
}

function insertMarketCache(db: Database.Database, stockCode: string, price: number): void {
  db.prepare(
    `INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at)
     VALUES (?, ?, ?, 0, 1000000, datetime('now'))`
  ).run(stockCode, stockCode, price);
}

function insertSnapshot(
  db: Database.Database,
  userId: number,
  date: string,
  stockCode: string,
  stockName: string,
  shares: number,
  costPrice: number,
  marketPrice: number,
  sector: string
): void {
  const marketValue = shares * marketPrice;
  const profitLoss = marketValue - shares * costPrice;
  db.prepare(
    `INSERT OR REPLACE INTO portfolio_snapshots
       (user_id, snapshot_date, stock_code, stock_name, shares, cost_price, market_price, market_value, profit_loss, sector)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, date, stockCode, stockName, shares, costPrice, marketPrice, marketValue, profitLoss, sector);
}

function getSnapshots(db: Database.Database, userId: number): Array<{
  stock_code: string; stock_name: string; shares: number;
  cost_price: number; market_price: number; market_value: number;
  profit_loss: number; sector: string;
}> {
  return db.prepare(
    'SELECT stock_code, stock_name, shares, cost_price, market_price, market_value, profit_loss, sector FROM portfolio_snapshots WHERE user_id = ? ORDER BY stock_code'
  ).all(userId) as any[];
}

beforeEach(() => {
  testDb = makeDb();
});

afterEach(() => {
  testDb.close();
});

// --- takeSnapshot ---

describe('takeSnapshot', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
  });

  it('should create snapshot rows for holding positions with market cache', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100, 8.0);
    insertMarketCache(testDb, '600000', 10.0);
    insertPosition(testDb, 1, '300001', '特锐德', 200, 15.0);
    insertMarketCache(testDb, '300001', 20.0);

    takeSnapshot(1, '2024-06-03', testDb);

    const snaps = getSnapshots(testDb, 1);
    expect(snaps).toHaveLength(2);

    const sh = snaps.find((s) => s.stock_code === '600000')!;
    expect(sh.stock_name).toBe('浦发银行');
    expect(sh.shares).toBe(100);
    expect(sh.cost_price).toBe(8.0);
    expect(sh.market_price).toBe(10.0);
    expect(sh.market_value).toBe(1000); // 100 * 10
    expect(sh.profit_loss).toBe(200);   // 1000 - 100*8
    expect(sh.sector).toBe('沪市主板');

    const cy = snaps.find((s) => s.stock_code === '300001')!;
    expect(cy.market_value).toBe(4000); // 200 * 20
    expect(cy.profit_loss).toBe(1000);  // 4000 - 200*15
    expect(cy.sector).toBe('创业板');
  });

  it('should skip positions without market cache', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100, 8.0);
    // No market cache for 600000
    insertPosition(testDb, 1, '300001', '特锐德', 200, 15.0);
    insertMarketCache(testDb, '300001', 20.0);

    takeSnapshot(1, '2024-06-03', testDb);

    const snaps = getSnapshots(testDb, 1);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].stock_code).toBe('300001');
  });

  it('should handle re-runs on same day (INSERT OR REPLACE)', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100, 8.0);
    insertMarketCache(testDb, '600000', 10.0);

    takeSnapshot(1, '2024-06-03', testDb);
    // Update market price and re-run
    insertMarketCache(testDb, '600000', 12.0);
    takeSnapshot(1, '2024-06-03', testDb);

    const snaps = getSnapshots(testDb, 1);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].market_price).toBe(12.0);
    expect(snaps[0].market_value).toBe(1200);
  });

  it('should do nothing when user has no positions', () => {
    takeSnapshot(1, '2024-06-03', testDb);
    const snaps = getSnapshots(testDb, 1);
    expect(snaps).toHaveLength(0);
  });

  it('should skip watching positions', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100, 8.0, 'watching');
    insertMarketCache(testDb, '600000', 10.0);

    takeSnapshot(1, '2024-06-03', testDb);
    const snaps = getSnapshots(testDb, 1);
    expect(snaps).toHaveLength(0);
  });

  it('should not snapshot holdings whose buy_date is after the snapshot date', () => {
    insertPosition(testDb, 1, '601985', '中国核电', 100, 9.0);
    insertMarketCache(testDb, '601985', 10.0);
    testDb
      .prepare(`UPDATE positions SET buy_date = ? WHERE user_id = 1 AND stock_code = '601985'`)
      .run('2024-07-01');

    takeSnapshot(1, '2024-06-03', testDb);
    const snaps = getSnapshots(testDb, 1);
    expect(snaps).toHaveLength(0);
  });

  it('should not write snapshots on Sunday (non-trading day)', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100, 8.0);
    insertMarketCache(testDb, '600000', 10.0);
    takeSnapshot(1, '2024-06-02', testDb);
    expect(getSnapshots(testDb, 1)).toHaveLength(0);
  });
});

describe('deleteSnapshotsOnNonTradingDays', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
    insertSnapshot(testDb, 1, '2024-06-02', '600000', '浦发银行', 100, 8, 10, '沪市主板');
    insertSnapshot(testDb, 1, '2024-06-03', '600000', '浦发银行', 100, 8, 10, '沪市主板');
  });

  it('removes all rows on weekend dates but keeps trading days', () => {
    const n = deleteSnapshotsOnNonTradingDays(testDb);
    expect(n).toBe(1);
    const dates = testDb
      .prepare('SELECT DISTINCT snapshot_date FROM portfolio_snapshots WHERE user_id = 1')
      .all() as { snapshot_date: string }[];
    expect(dates.map((r) => r.snapshot_date)).toEqual(['2024-06-03']);
  });

  it('removes statutory holiday weekday rows (e.g. 2026 Qingming 2026-04-06)', () => {
    insertSnapshot(testDb, 1, '2026-04-03', '600000', '浦发银行', 100, 8, 10, '沪市主板');
    insertSnapshot(testDb, 1, '2026-04-06', '600000', '浦发银行', 100, 8, 10, '沪市主板');
    const n = deleteSnapshotsOnNonTradingDays(testDb);
    expect(n).toBeGreaterThanOrEqual(1);
    const dates = testDb
      .prepare(
        'SELECT DISTINCT snapshot_date FROM portfolio_snapshots WHERE user_id = 1 ORDER BY snapshot_date'
      )
      .all() as { snapshot_date: string }[];
    expect(dates.map((r) => r.snapshot_date)).toEqual(['2024-06-03', '2026-04-03']);
  });
});

describe('deleteSnapshotsViolatingBuyDate', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
    testDb
      .prepare(
        `INSERT INTO positions (user_id, stock_code, stock_name, position_type, cost_price, shares, buy_date)
         VALUES (1, '601985', '中国核电', 'holding', 9, 100, '2024-04-10')`
      )
      .run();
    insertSnapshot(testDb, 1, '2024-04-01', '601985', '中国核电', 100, 9, 9.5, '沪市主板');
    insertSnapshot(testDb, 1, '2024-04-10', '601985', '中国核电', 100, 9, 9.5, '沪市主板');
    insertSnapshot(testDb, 1, '2024-04-12', '601985', '中国核电', 100, 9, 10, '沪市主板');
  });

  it('removes snapshots strictly before buy_date', () => {
    const n = deleteSnapshotsViolatingBuyDate(testDb);
    expect(n).toBe(1);
    const rows = testDb
      .prepare('SELECT snapshot_date FROM portfolio_snapshots WHERE user_id = 1 ORDER BY snapshot_date')
      .all() as { snapshot_date: string }[];
    expect(rows.map((r) => r.snapshot_date)).toEqual(['2024-04-10', '2024-04-12']);
  });
});

// --- takeAllUsersSnapshot ---

describe('takeAllUsersSnapshot', () => {
  it('should process all users with holding positions', () => {
    insertUser(testDb, 1);
    insertUser(testDb, 2);

    insertPosition(testDb, 1, '600000', '浦发银行', 100, 8.0);
    insertMarketCache(testDb, '600000', 10.0);

    insertPosition(testDb, 2, '300001', '特锐德', 200, 15.0);
    insertMarketCache(testDb, '300001', 20.0);

    takeAllUsersSnapshot('2024-06-03', testDb);

    const snaps1 = getSnapshots(testDb, 1);
    const snaps2 = getSnapshots(testDb, 2);
    expect(snaps1).toHaveLength(1);
    expect(snaps1[0].stock_code).toBe('600000');
    expect(snaps2).toHaveLength(1);
    expect(snaps2[0].stock_code).toBe('300001');
  });

  it('should handle no users with positions', () => {
    takeAllUsersSnapshot('2024-06-03', testDb);
    const count = testDb.prepare('SELECT COUNT(*) as c FROM portfolio_snapshots').get() as { c: number };
    expect(count.c).toBe(0);
  });
});

// --- getProfitCurve ---

describe('getProfitCurve', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
  });

  it('should return correct aggregation grouped by date', () => {
    // Use today-relative dates so the period filter works
    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() - 2);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 1);
    const date1 = d1.toISOString().split('T')[0];
    const date2 = d2.toISOString().split('T')[0];

    // Day 1: two stocks
    insertSnapshot(testDb, 1, date1, '600000', '浦发银行', 100, 8, 10, '沪市主板');
    insertSnapshot(testDb, 1, date1, '300001', '特锐德', 200, 15, 20, '创业板');
    // Day 2: same stocks, different prices
    insertSnapshot(testDb, 1, date2, '600000', '浦发银行', 100, 8, 11, '沪市主板');
    insertSnapshot(testDb, 1, date2, '300001', '特锐德', 200, 15, 18, '创业板');

    const curve = getProfitCurve(1, '7d', testDb);

    expect(curve).toHaveLength(2);
    // Day 1: totalValue = 1000 + 4000 = 5000, totalProfit = 200 + 1000 = 1200
    expect(curve[0].date).toBe(date1);
    expect(curve[0].totalValue).toBe(5000);
    expect(curve[0].totalProfit).toBe(1200);
    expect(curve[0].totalCost).toBe(3800);
    expect(curve[0].returnOnCostPct).toBeCloseTo(31.58, 1);
    expect(curve[0].dayMvChangePct).toBeNull();
    expect(curve[0].dayProfitDelta).toBeNull();
    // Day 2: totalValue = 1100 + 3600 = 4700, totalProfit = 300 + 600 = 900
    expect(curve[1].date).toBe(date2);
    expect(curve[1].totalValue).toBe(4700);
    expect(curve[1].totalProfit).toBe(900);
    expect(curve[1].totalCost).toBe(3800);
    expect(curve[1].returnOnCostPct).toBeCloseTo(23.68, 1);
    expect(curve[1].dayMvChangePct).toBeCloseTo(-6, 2); // (4700-5000)/5000*100
    expect(curve[1].dayProfitDelta).toBe(-300);
  });

  it('should return empty array when no snapshots exist', () => {
    const curve = getProfitCurve(1, '30d', testDb);
    expect(curve).toHaveLength(0);
  });

  it('should filter by period', () => {
    // Insert a snapshot 60 days ago — should not appear in 30d query
    const old = new Date();
    old.setDate(old.getDate() - 60);
    const oldDate = old.toISOString().split('T')[0];
    insertSnapshot(testDb, 1, oldDate, '600000', '浦发银行', 100, 8, 10, '沪市主板');

    const recent = new Date();
    recent.setDate(recent.getDate() - 1);
    const recentDate = recent.toISOString().split('T')[0];
    insertSnapshot(testDb, 1, recentDate, '600000', '浦发银行', 100, 8, 11, '沪市主板');

    const curve30 = getProfitCurve(1, '30d', testDb);
    expect(curve30).toHaveLength(1);
    expect(curve30[0].date).toBe(recentDate);

    const curve90 = getProfitCurve(1, '90d', testDb);
    expect(curve90).toHaveLength(2);
  });
});

// --- getSectorDistribution ---

describe('getSectorDistribution', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
  });

  it('should return sector percentages summing to 100%', () => {
    const today = new Date().toISOString().split('T')[0];
    insertSnapshot(testDb, 1, today, '600000', '浦发银行', 100, 8, 10, '沪市主板');
    insertSnapshot(testDb, 1, today, '300001', '特锐德', 200, 15, 20, '创业板');
    insertSnapshot(testDb, 1, today, '688001', '华兴源创', 50, 30, 40, '科创板');

    const dist = getSectorDistribution(1, testDb);

    expect(dist.length).toBe(3);
    const totalPct = dist.reduce((sum, d) => sum + d.percentage, 0);
    expect(totalPct).toBeCloseTo(100, 5);

    // 创业板: 4000, 沪市主板: 1000, 科创板: 2000 → total 7000
    const cy = dist.find((d) => d.sector === '创业板')!;
    expect(cy.value).toBe(4000);
    expect(cy.percentage).toBeCloseTo((4000 / 7000) * 100, 5);
  });

  it('should use latest snapshot date only', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    insertSnapshot(testDb, 1, yDate, '600000', '浦发银行', 100, 8, 10, '沪市主板');
    insertSnapshot(testDb, 1, today, '300001', '特锐德', 200, 15, 20, '创业板');

    const dist = getSectorDistribution(1, testDb);
    // Should only include today's snapshot
    expect(dist).toHaveLength(1);
    expect(dist[0].sector).toBe('创业板');
    expect(dist[0].percentage).toBeCloseTo(100, 5);
  });

  it('should return empty array when no snapshots exist', () => {
    const dist = getSectorDistribution(1, testDb);
    expect(dist).toHaveLength(0);
  });
});

// --- getStockPnl ---

describe('getStockPnl', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
  });

  it('should return stocks sorted descending by profitLoss', () => {
    const today = new Date().toISOString().split('T')[0];
    // profit_loss: 200 (1000 - 800)
    insertSnapshot(testDb, 1, today, '600000', '浦发银行', 100, 8, 10, '沪市主板');
    // profit_loss: 1000 (4000 - 3000)
    insertSnapshot(testDb, 1, today, '300001', '特锐德', 200, 15, 20, '创业板');
    // profit_loss: -500 (2000 - 2500)
    insertSnapshot(testDb, 1, today, '688001', '华兴源创', 50, 50, 40, '科创板');

    const pnl = getStockPnl(1, testDb);

    expect(pnl).toHaveLength(3);
    // Sorted descending: 1000, 200, -500
    expect(pnl[0].stockCode).toBe('300001');
    expect(pnl[0].profitLoss).toBe(1000);
    expect(pnl[1].stockCode).toBe('600000');
    expect(pnl[1].profitLoss).toBe(200);
    expect(pnl[2].stockCode).toBe('688001');
    expect(pnl[2].profitLoss).toBe(-500);
  });

  it('should return empty array when no snapshots exist', () => {
    const pnl = getStockPnl(1, testDb);
    expect(pnl).toHaveLength(0);
  });
});

// --- countTradingDaysExclusiveBetween ---

describe('countTradingDaysExclusiveBetween', () => {
  it('is zero between adjacent calendar dates with no trading day strictly between', () => {
    expect(countTradingDaysExclusiveBetween('2024-04-08', '2024-04-09')).toBe(0);
  });

  it('is positive across a week span', () => {
    expect(countTradingDaysExclusiveBetween('2024-04-01', '2024-04-08')).toBeGreaterThan(0);
  });
});

// --- getChartData ---

describe('getChartData', () => {
  it('should return all three chart data sections', () => {
    insertUser(testDb, 1);
    const today = new Date().toISOString().split('T')[0];
    insertSnapshot(testDb, 1, today, '600000', '浦发银行', 100, 8, 10, '沪市主板');

    const data = getChartData(1, '30d', testDb);

    expect(data.profitCurve).toHaveLength(1);
    expect(data.sectorDistribution).toHaveLength(1);
    expect(data.stockPnl).toHaveLength(1);
    expect(data.profitCurveMeta).toEqual({ hasCalendarGaps: false });
  });

  it('should return empty data for user with no snapshots', () => {
    insertUser(testDb, 1);
    const data = getChartData(1, '30d', testDb);

    expect(data.profitCurve).toHaveLength(0);
    expect(data.sectorDistribution).toHaveLength(0);
    expect(data.stockPnl).toHaveLength(0);
    expect(data.profitCurveMeta).toEqual({ hasCalendarGaps: false });
  });

  it('marks hasCalendarGaps when snapshot dates skip trading days', () => {
    insertUser(testDb, 1);
    const late = new Date();
    const early = new Date(late);
    early.setDate(early.getDate() - 20);
    const isoEarly = early.toISOString().slice(0, 10);
    const isoLate = late.toISOString().slice(0, 10);
    insertSnapshot(testDb, 1, isoEarly, '600000', '浦发银行', 100, 8, 10, '沪市主板');
    insertSnapshot(testDb, 1, isoLate, '600000', '浦发银行', 100, 8, 11, '沪市主板');

    const data = getChartData(1, '365d', testDb);
    expect(data.profitCurve.length).toBeGreaterThanOrEqual(2);
    if (countTradingDaysExclusiveBetween(isoEarly, isoLate) > 0) {
      expect(data.profitCurveMeta?.hasCalendarGaps).toBe(true);
    }
  });
});
