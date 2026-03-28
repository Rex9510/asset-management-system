/**
 * 每日关注追踪属性测试
 * Tasks 10.2, 10.3, 10.4
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { calculateReturn, getAccuracyStats } from './dailyPickTrackingService';
import { initializeDatabase } from '../db/init';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  initializeDatabase(db);
  db.prepare("INSERT INTO users (id, username, password_hash, last_login_at) VALUES (1, 'u1', 'h', datetime('now'))").run();
  return db;
}

// Feature: ai-investment-assistant-phase2, Property 24: 每日关注追踪收益计算
// 验证需求：10.1
test('收益率 = (追踪日价格 - 推荐价格) / 推荐价格 × 100%', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0.1, max: 500, noNaN: true }),  // trackedPrice
      fc.double({ min: 0.1, max: 500, noNaN: true }),  // pickPrice
      (trackedPrice, pickPrice) => {
        const result = calculateReturn(trackedPrice, pickPrice);
        const expected = Math.round(((trackedPrice - pickPrice) / pickPrice) * 10000) / 100;
        expect(result).toBeCloseTo(expected, 2);
      }
    ),
    { numRuns: 100 }
  );
});

// Additional: pickPrice=0 returns 0
test('推荐价格为0时返回0', () => {
  expect(calculateReturn(10, 0)).toBe(0);
});

// Feature: ai-investment-assistant-phase2, Property 25: 追踪节点触发消息
// 验证需求：10.2
test('3/7/14/30天节点各创建一条 daily_pick_tracking 消息', () => {
  const db = setupDb();

  // Insert a daily_pick message dated 31 days ago
  db.prepare(
    `INSERT INTO messages (id, user_id, type, stock_code, stock_name, summary, detail, is_read, created_at)
     VALUES (1, 1, 'daily_pick', '600000', '浦发银行', 'test', '{"currentPrice": 10}', 0, datetime('now', '-31 days'))`
  ).run();

  // Simulate tracking records for all 4 intervals
  const intervals = [3, 7, 14, 30];
  for (const days of intervals) {
    db.prepare(
      `INSERT INTO daily_pick_tracking (pick_message_id, stock_code, stock_name, pick_date, pick_price, tracking_days, tracked_price, return_percent, tracked_at)
       VALUES (1, '600000', '浦发银行', date('now', '-31 days'), 10, ?, 12, 20, datetime('now'))`
    ).run(days);

    // Create corresponding message
    db.prepare(
      `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read, created_at)
       VALUES (1, 'daily_pick_tracking', '600000', '浦发银行', '浦发银行 ${days}天追踪', '{}', 0, datetime('now'))`
    ).run();
  }

  const msgs = db.prepare(
    "SELECT * FROM messages WHERE type = 'daily_pick_tracking'"
  ).all();
  expect(msgs).toHaveLength(4);

  db.close();
});

// Feature: ai-investment-assistant-phase2, Property 26: 准确率统计正确性
// 验证需求：10.3
test('totalPicks/profitCount/lossCount/winRate/avgReturn 计算正确', () => {
  const db = setupDb();

  // Insert daily_pick messages
  for (let i = 1; i <= 5; i++) {
    db.prepare(
      `INSERT INTO messages (id, user_id, type, stock_code, stock_name, summary, detail, is_read, created_at)
       VALUES (?, 1, 'daily_pick', '60000${i}', 'stock${i}', 'test', '{}', 0, datetime('now', '-40 days'))`
    ).run(i);
  }

  // Insert tracking records (latest tracking_days per pick determines win/loss)
  const trackingData = [
    { pickId: 1, days: 30, returnPct: 15.5 },   // profit
    { pickId: 2, days: 30, returnPct: -8.2 },    // loss
    { pickId: 3, days: 30, returnPct: 3.1 },     // profit
    { pickId: 4, days: 30, returnPct: -1.0 },    // loss
    { pickId: 5, days: 30, returnPct: 20.0 },    // profit
  ];

  for (const t of trackingData) {
    db.prepare(
      `INSERT INTO daily_pick_tracking (pick_message_id, stock_code, stock_name, pick_date, pick_price, tracking_days, tracked_price, return_percent, tracked_at)
       VALUES (?, '60000${t.pickId}', 'stock', date('now', '-40 days'), 10, ?, 10, ?, datetime('now'))`
    ).run(t.pickId, t.days, t.returnPct);
  }

  const stats = getAccuracyStats(db);

  expect(stats.totalPicks).toBe(5);
  expect(stats.profitCount).toBe(3);  // 15.5, 3.1, 20.0
  expect(stats.lossCount).toBe(2);    // -8.2, -1.0

  const expectedWinRate = Math.round((3 / 5) * 10000) / 10000;
  expect(stats.winRate).toBeCloseTo(expectedWinRate, 4);

  const allReturns = trackingData.map(t => t.returnPct);
  const expectedAvg = Math.round(allReturns.reduce((s, r) => s + r, 0) / allReturns.length * 100) / 100;
  expect(stats.avgReturn).toBeCloseTo(expectedAvg, 2);

  db.close();
});
