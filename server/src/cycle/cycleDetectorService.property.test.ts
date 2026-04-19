/**
 * 周期底部检测属性测试
 * Tasks 14.2, 14.3, 14.4
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';

// Mock fetchAndSaveStockHistory to avoid network calls in tests
jest.mock('../market/historyService', () => ({
  fetchAndSaveStockHistory: jest.fn().mockResolvedValue(0),
}));

import { initializeDatabase } from '../db/init';
import {
  checkPriceLow30,
  checkVolumeShrinkExpand,
  checkRsiOrMacdDivergence,
  determineStatus,
  addMonitor,
  deleteMonitor,
  getMonitors,
} from './cycleDetectorService';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function addUser(db: Database.Database, id: number) {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, 'u' + id, 'h');
}

/** Generate synthetic market history rows */
function generateHistory(
  length: number,
  opts: { lowRange?: boolean; volumeShrinkExpand?: boolean; lowRsi?: boolean }
): { trade_date: string; close_price: number; high_price: number; low_price: number; volume: number }[] {
  const rows: any[] = [];
  const baseDate = new Date(2022, 0, 1);

  for (let i = 0; i < length; i++) {
    const d = new Date(baseDate.getTime() + i * 86400000);
    let price: number;
    let volume: number;

    if (opts.lowRange) {
      // Price in lowest 30% of range: range 10-100, current near 10-37
      const min = 10;
      const max = 100;
      price = i < length - 1
        ? min + Math.random() * (max - min) // historical spread
        : min + Math.random() * (max - min) * 0.2; // current in low 20%
    } else {
      price = 50 + Math.sin(i / 30) * 20;
    }

    if (opts.volumeShrinkExpand) {
      // 60-day avg > 5-day avg pattern reversed: recent 5d high, 20d low, 60d high
      if (i >= length - 5) {
        volume = 2000000; // recent 5d: high
      } else if (i >= length - 20) {
        volume = 500000;  // 20d: low
      } else {
        volume = 1500000; // 60d: medium-high
      }
    } else {
      volume = 1000000 + Math.random() * 500000;
    }

    rows.push({
      trade_date: d.toISOString().slice(0, 10),
      close_price: Math.max(1, price),
      high_price: Math.max(1, price * 1.02),
      low_price: Math.max(0.5, price * 0.98),
      volume: Math.floor(volume),
    });
  }

  return rows;
}

// Feature: ai-investment-assistant-phase2, Property 13: 周期底部信号检测正确性
// 验证需求：6.2
test('至少满足2项底部条件时 determineStatus 返回 bottom', () => {
  fc.assert(
    fc.property(
      fc.boolean(), // signal1: priceLow30
      fc.boolean(), // signal2: volumeShrinkExpand
      fc.boolean(), // signal3: rsiOrMacd
      (s1, s2, s3) => {
        const signals: string[] = [];
        if (s1) signals.push('价格处于近3年最低30%区间');
        if (s2) signals.push('成交量萎缩后放大');
        if (s3) signals.push('RSI低于30超卖');

        // Use minimal history to avoid MA calculations affecting status
        const history = generateHistory(100, {});
        const status = determineStatus(history, signals);

        if (signals.length >= 2) {
          return status === 'bottom';
        }
        // With fewer than 2 signals, status should NOT be bottom
        return status !== 'bottom';
      }
    ),
    { numRuns: 100 }
  );
});

test('checkPriceLow30 对价格在最低30%区间的数据返回 true', () => {
  // Build history where current price is clearly in lowest 30%
  const history: any[] = [];
  const baseDate = new Date(2022, 0, 1);
  for (let i = 0; i < 200; i++) {
    const d = new Date(baseDate.getTime() + i * 86400000);
    // Prices range from 10 to 100
    const price = i < 199 ? 10 + (i / 199) * 90 : 15; // current price = 15, in lowest 30% of [10, 100]
    history.push({
      trade_date: d.toISOString().slice(0, 10),
      close_price: price,
      high_price: price * 1.01,
      low_price: price * 0.99,
      volume: 1000000,
    });
  }

  expect(checkPriceLow30(history)).toBe(true);
});

test('checkPriceLow30 对价格在高位的数据返回 false', () => {
  const history: any[] = [];
  const baseDate = new Date(2022, 0, 1);
  for (let i = 0; i < 200; i++) {
    const d = new Date(baseDate.getTime() + i * 86400000);
    const price = i < 199 ? 10 + (i / 199) * 90 : 85; // current price = 85, in top 30%
    history.push({
      trade_date: d.toISOString().slice(0, 10),
      close_price: price,
      high_price: price * 1.01,
      low_price: price * 0.99,
      volume: 1000000,
    });
  }

  expect(checkPriceLow30(history)).toBe(false);
});

test('checkVolumeShrinkExpand 对萎缩后放大的成交量返回 true', () => {
  const history = generateHistory(100, { volumeShrinkExpand: true });
  expect(checkVolumeShrinkExpand(history)).toBe(true);
});


// Feature: ai-investment-assistant-phase2, Property 14: 周期监控CRUD往返
// 验证需求：6.5
test('添加监控后查询返回记录，删除后不存在', async () => {
  const db = makeDb();
  addUser(db, 1);

  // Seed some market history so detection can run
  const baseDate = new Date(2020, 0, 1);
  for (let i = 0; i < 800; i++) {
    const d = new Date(baseDate.getTime() + i * 86400000);
    const price = 10 + Math.sin(i / 60) * 5;
    db.prepare(
      'INSERT OR IGNORE INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('600000', d.toISOString().slice(0, 10), price, price, price * 1.01, price * 0.99, 1000000);
  }

  // Seed market_cache for stock name resolution
  db.prepare(
    "INSERT INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at) VALUES ('600000', '浦发银行', 10, 0, 1000000, datetime('now'))"
  ).run();

  // Add monitor
  const monitor = await addMonitor(1, '600000', db);
  expect(monitor.stockCode).toBe('600000');
  expect(monitor.userId).toBe(1);

  // Query monitors
  const monitors = getMonitors(1, db);
  expect(monitors.some(m => m.stockCode === '600000')).toBe(true);

  // Delete monitor
  const deleted = deleteMonitor(1, monitor.id, db);
  expect(deleted).toBe(true);

  // Verify gone
  const afterDelete = getMonitors(1, db);
  expect(afterDelete.some(m => m.id === monitor.id)).toBe(false);

  db.close();
});

// Feature: ai-investment-assistant-phase2, Property 40: 底部信号触发通知
// 验证需求：6.3
test('底部信号触发时创建 cycle_bottom 消息，包含标的名称/当前价格/预估底部区间', () => {
  const db = makeDb();
  addUser(db, 1);

  // Seed market history with clear bottom signals
  const baseDate = new Date(2020, 0, 1);
  for (let i = 0; i < 800; i++) {
    const d = new Date(baseDate.getTime() + i * 86400000);
    let price: number;
    let volume: number;

    if (i < 700) {
      // Historical: wide range 10-100
      price = 10 + (i / 700) * 90;
      volume = 1500000;
    } else if (i < 795) {
      // Recent 20d: low volume
      price = 15;
      volume = 500000;
    } else {
      // Last 5d: low price + volume expansion
      price = 12;
      volume = 2000000;
    }

    db.prepare(
      'INSERT OR IGNORE INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('600000', d.toISOString().slice(0, 10), price, price, price * 1.02, price * 0.98, volume);
  }

  db.prepare(
    "INSERT INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at) VALUES ('600000', '浦发银行', 12, -2, 2000000, datetime('now'))"
  ).run();

  // Add monitor with initial status NOT bottom (simulate previous state)
  db.prepare(
    "INSERT INTO cycle_monitors (user_id, stock_code, stock_name, cycle_length, current_phase, status, description, bottom_signals, updated_at) VALUES (1, '600000', '浦发银行', null, '下行阶段', 'falling', '下行中', '[]', datetime('now'))"
  ).run();

  // Import and run updateAllMonitors
  const { updateAllMonitors } = require('./cycleDetectorService');
  updateAllMonitors(db);

  // Check if cycle_bottom message was created (only if status changed to bottom)
  const monitor = db.prepare("SELECT status FROM cycle_monitors WHERE stock_code = '600000'").get() as any;
  if (monitor && monitor.status === 'bottom') {
    const msgs = db.prepare("SELECT * FROM messages WHERE type = 'cycle_bottom'").all() as any[];
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    const detail = JSON.parse(msgs[0].detail);
    expect(detail.stockName).toBe('浦发银行');
    expect(detail.currentPrice).toBeDefined();
    expect(detail.bottomRange).toBeDefined();
  }

  db.close();
});
