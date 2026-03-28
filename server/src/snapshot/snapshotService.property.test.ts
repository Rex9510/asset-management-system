/**
 * 持仓快照属性测试
 * Tasks 21.2, 21.3, 21.4
 */
import Database from 'better-sqlite3';
import { takeSnapshot, getProfitCurve, getSectorDistribution, getStockPnl } from './snapshotService';
import { initializeDatabase } from '../db/init';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  initializeDatabase(db);
  db.prepare("INSERT INTO users (id, username, password_hash, last_login_at) VALUES (1, 'u1', 'h', datetime('now'))").run();
  return db;
}

function addHolding(db: Database.Database, id: number, stockCode: string, stockName: string, shares: number, costPrice: number, marketPrice: number) {
  db.prepare(
    "INSERT INTO positions (id, user_id, stock_code, stock_name, cost_price, shares, position_type) VALUES (?, 1, ?, ?, ?, ?, 'holding')"
  ).run(id, stockCode, stockName, costPrice, shares);
  db.prepare(
    "INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at) VALUES (?, ?, ?, 0, 0, datetime('now'))"
  ).run(stockCode, stockName, marketPrice);
}

// Feature: ai-investment-assistant-phase2, Property 34: 收益曲线数据正确性
// 验证需求：15.1
test('totalValue=该日所有持仓市值之和，totalProfit=totalValue-总成本', () => {
  const db = setupDb();

  addHolding(db, 1, '600000', '浦发银行', 1000, 10, 12);  // value=12000, cost=10000, profit=2000
  addHolding(db, 2, '300001', '特锐德', 500, 20, 18);      // value=9000, cost=10000, profit=-1000

  const today = new Date().toISOString().slice(0, 10);
  takeSnapshot(1, today, db);

  const curve = getProfitCurve(1, '30d', db);
  expect(curve).toHaveLength(1);

  const point = curve[0];
  // totalValue = 1000*12 + 500*18 = 12000 + 9000 = 21000
  expect(point.totalValue).toBeCloseTo(21000, 0);
  // totalProfit = (12000-10000) + (9000-10000) = 2000 + (-1000) = 1000
  expect(point.totalProfit).toBeCloseTo(1000, 0);

  db.close();
});

// Feature: ai-investment-assistant-phase2, Property 35: 板块分布数据正确性
// 验证需求：15.2
test('各板块 percentage 之和=100%，每个板块 value=该板块下所有股票市值之和', () => {
  const db = setupDb();

  addHolding(db, 1, '600000', '浦发银行', 1000, 10, 10);  // 沪市主板 10000
  addHolding(db, 2, '601398', '工商银行', 500, 6, 6);      // 沪市主板 3000
  addHolding(db, 3, '300001', '特锐德', 200, 25, 25);      // 创业板 5000

  const today = new Date().toISOString().slice(0, 10);
  takeSnapshot(1, today, db);

  const dist = getSectorDistribution(1, db);
  expect(dist.length).toBeGreaterThan(0);

  const totalPct = dist.reduce((sum, d) => sum + d.percentage, 0);
  expect(totalPct).toBeCloseTo(100, 1);

  // 沪市主板 value = 10000 + 3000 = 13000
  const sh = dist.find(d => d.sector === '沪市主板');
  expect(sh).toBeDefined();
  expect(sh!.value).toBeCloseTo(13000, 0);

  // 创业板 value = 5000
  const gem = dist.find(d => d.sector === '创业板');
  expect(gem).toBeDefined();
  expect(gem!.value).toBeCloseTo(5000, 0);

  db.close();
});

// Feature: ai-investment-assistant-phase2, Property 36: 盈亏柱状图排序
// 验证需求：15.3
test('数据按盈亏金额降序排列', () => {
  const db = setupDb();

  addHolding(db, 1, '600000', '浦发银行', 1000, 10, 12);  // profit = 2000
  addHolding(db, 2, '300001', '特锐德', 500, 20, 15);      // profit = -2500
  addHolding(db, 3, '000001', '平安银行', 800, 10, 11);    // profit = 800

  const today = new Date().toISOString().slice(0, 10);
  takeSnapshot(1, today, db);

  const pnl = getStockPnl(1, db);
  expect(pnl.length).toBe(3);

  // Should be sorted by profitLoss descending
  for (let i = 1; i < pnl.length; i++) {
    expect(pnl[i - 1].profitLoss).toBeGreaterThanOrEqual(pnl[i].profitLoss);
  }

  db.close();
});
