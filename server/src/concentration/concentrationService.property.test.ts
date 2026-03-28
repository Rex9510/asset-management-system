/**
 * 持仓集中度属性测试
 * Tasks 18.2, 18.3
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { getSectorFromCode, getConcentration, checkConcentrationRisk } from './concentrationService';
import { initializeDatabase } from '../db/init';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  initializeDatabase(db);
  db.prepare("INSERT INTO users (id, username, password_hash, last_login_at) VALUES (1, 'u1', 'h', datetime('now'))").run();
  return db;
}

function addPosition(db: Database.Database, id: number, stockCode: string, stockName: string, shares: number, price: number) {
  db.prepare(
    "INSERT INTO positions (id, user_id, stock_code, stock_name, cost_price, shares, position_type) VALUES (?, 1, ?, ?, ?, ?, 'holding')"
  ).run(id, stockCode, stockName, price, shares);
  db.prepare(
    "INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at) VALUES (?, ?, ?, 0, 0, datetime('now'))"
  ).run(stockCode, stockName, price);
}

// Feature: ai-investment-assistant-phase2, Property 28: 持仓集中度计算正确性
// 验证需求：12.1
test('各板块占比之和=100%', () => {
  const db = setupDb();

  // Add positions across different sectors
  addPosition(db, 1, '600000', '浦发银行', 1000, 10);   // 沪市主板
  addPosition(db, 2, '300001', '特锐德', 500, 20);       // 创业板
  addPosition(db, 3, '000001', '平安银行', 800, 15);     // 深市主板

  const result = getConcentration(1, db);

  expect(result.sectors.length).toBeGreaterThan(0);

  const totalPercentage = result.sectors.reduce((sum, s) => sum + s.percentage, 0);
  expect(totalPercentage).toBeCloseTo(100, 1);

  // Each sector percentage = sector value / total value * 100
  for (const sector of result.sectors) {
    const expectedPct = (sector.totalValue / result.totalValue) * 100;
    expect(sector.percentage).toBeCloseTo(expectedPct, 4);
  }

  db.close();
});

// Feature: ai-investment-assistant-phase2, Property 29: 集中度超阈值触发通知
// 验证需求：12.2
test('某板块占比>60%时创建 concentration_risk 消息', () => {
  const db = setupDb();

  // All positions in same sector (沪市主板) → >60%
  addPosition(db, 1, '600000', '浦发银行', 1000, 10);
  addPosition(db, 2, '601398', '工商银行', 2000, 5);
  // Small position in another sector
  addPosition(db, 3, '300001', '特锐德', 10, 5);

  checkConcentrationRisk(1, db);

  const msg = db.prepare("SELECT * FROM messages WHERE type = 'concentration_risk'").get() as {
    type: string; summary: string;
  } | undefined;

  expect(msg).toBeDefined();
  expect(msg!.type).toBe('concentration_risk');

  db.close();
});

// Additional: getSectorFromCode mapping
test('getSectorFromCode 板块映射正确', () => {
  expect(getSectorFromCode('600000')).toBe('沪市主板');
  expect(getSectorFromCode('601398')).toBe('沪市主板');
  expect(getSectorFromCode('300001')).toBe('创业板');
  expect(getSectorFromCode('000001')).toBe('深市主板');
  expect(getSectorFromCode('688001')).toBe('科创板');
  expect(getSectorFromCode('999')).toBe('其他');
  expect(getSectorFromCode('')).toBe('其他');
});

// Additional: empty positions → no risk
test('空持仓不触发风险', () => {
  const db = setupDb();
  const result = getConcentration(1, db);
  expect(result.sectors).toHaveLength(0);
  expect(result.riskWarning).toBeNull();
  db.close();
});
