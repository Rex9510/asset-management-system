/**
 * 止损线属性测试
 * Tasks 8.2, 8.3, 8.4
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { setStopLoss, checkStopLossAlerts, checkAndNotifyStopLoss } from './stopLossService';
import { initializeDatabase } from '../db/init';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  initializeDatabase(db);
  db.prepare("INSERT INTO users (id, username, password_hash, last_login_at) VALUES (1, 'u1', 'h', datetime('now'))").run();
  db.prepare(
    "INSERT INTO positions (id, user_id, stock_code, stock_name, cost_price, shares, position_type) VALUES (1, 1, '600000', '浦发银行', 10.0, 1000, 'holding')"
  ).run();
  return db;
}

// Feature: ai-investment-assistant-phase2, Property 18: 止损线设置往返
// 验证需求：8.1
test('设置止损价后查询返回相同值', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0.01, max: 1000, noNaN: true }),
      (stopLossPrice) => {
        const db = setupDb();
        const rounded = Math.round(stopLossPrice * 100) / 100;

        setStopLoss(1, 1, rounded, db);

        const row = db.prepare('SELECT stop_loss_price FROM positions WHERE id = 1').get() as { stop_loss_price: number };
        expect(row.stop_loss_price).toBeCloseTo(rounded, 2);

        db.close();
      }
    ),
    { numRuns: 50 }
  );
});

// Feature: ai-investment-assistant-phase2, Property 19: 止损线触发正确性
// 验证需求：8.2
test('当前价 < 止损价时触发 stop_loss_alert', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 5, max: 50, noNaN: true }),   // stopLossPrice
      fc.double({ min: 0.1, max: 100, noNaN: true }), // currentPrice
      (stopLossPrice, currentPrice) => {
        const db = setupDb();
        const slp = Math.round(stopLossPrice * 100) / 100;
        const cp = Math.round(currentPrice * 100) / 100;

        setStopLoss(1, 1, slp, db);
        db.prepare("INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at) VALUES ('600000', '浦发银行', ?, 0, 0, datetime('now'))").run(cp);

        const alerts = checkStopLossAlerts(1, db);
        expect(alerts).toHaveLength(1);

        if (cp <= slp) {
          expect(alerts[0].triggered).toBe(true);
        } else {
          expect(alerts[0].triggered).toBe(false);
        }

        db.close();
      }
    ),
    { numRuns: 50 }
  );
});

// Feature: ai-investment-assistant-phase2, Property 20: 止损提醒内容完整性
// 验证需求：8.3
test('止损触发时创建消息，detail 包含关键信息', () => {
  const db = setupDb();

  setStopLoss(1, 1, 9.0, db);
  db.prepare("INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at) VALUES ('600000', '浦发银行', 8.5, -5, 100000, datetime('now'))").run();

  checkAndNotifyStopLoss(db);

  const msg = db.prepare("SELECT * FROM messages WHERE type = 'stop_loss_alert'").get() as {
    summary: string; detail: string;
  } | undefined;

  expect(msg).toBeDefined();
  expect(msg!.summary).toContain('浦发银行');
  expect(msg!.summary).toContain('止损线');

  const detail = JSON.parse(msg!.detail);
  expect(detail.stockCode).toBe('600000');
  expect(detail.stopLossPrice).toBe(9.0);
  expect(detail.currentPrice).toBe(8.5);

  db.close();
});
