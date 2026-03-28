/**
 * 操作日志属性测试
 * Tasks 19.2, 19.3
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { logOperation, getOperationLogs, generateReviews, getReviews } from './operationLogService';
import { initializeDatabase } from '../db/init';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  initializeDatabase(db);
  db.prepare("INSERT INTO users (id, username, password_hash, last_login_at) VALUES (1, 'u1', 'h', datetime('now'))").run();
  return db;
}

// Feature: ai-investment-assistant-phase2, Property 30: 操作日志自动记录
// 验证需求：13.1
test('持仓操作时自动创建操作日志，包含操作类型/股票代码/价格/份额/时间', () => {
  fc.assert(
    fc.property(
      fc.constantFrom<'create' | 'update' | 'delete'>('create', 'update', 'delete'),
      fc.double({ min: 1, max: 500, noNaN: true }),
      fc.integer({ min: 100, max: 10000 }),
      (operationType, price, shares) => {
        const db = setupDb();
        const roundedPrice = Math.round(price * 100) / 100;

        logOperation({
          userId: 1,
          operationType,
          stockCode: '600000',
          stockName: '浦发银行',
          price: roundedPrice,
          shares,
        }, db);

        const { logs, total } = getOperationLogs(1, 1, 10, db);
        expect(total).toBe(1);
        expect(logs).toHaveLength(1);
        expect(logs[0].operation_type).toBe(operationType);
        expect(logs[0].stock_code).toBe('600000');
        expect(logs[0].price).toBeCloseTo(roundedPrice, 2);
        expect(logs[0].shares).toBe(shares);
        expect(logs[0].created_at).toBeTruthy();

        db.close();
      }
    ),
    { numRuns: 30 }
  );
});

// Feature: ai-investment-assistant-phase2, Property 31: 复盘评价生成
// 验证需求：13.3
test('操作后7天和30天节点生成复盘评价', () => {
  const db = setupDb();

  // Insert a log dated 31 days ago with a price
  db.prepare(
    `INSERT INTO operation_logs (user_id, operation_type, stock_code, stock_name, price, shares, created_at)
     VALUES (1, 'create', '600000', '浦发银行', 10.0, 1000, datetime('now', '-31 days'))`
  ).run();

  // Insert market_cache for current price
  db.prepare(
    "INSERT INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at) VALUES ('600000', '浦发银行', 12.0, 0, 0, datetime('now'))"
  ).run();

  // Generate reviews
  generateReviews(db);

  const reviews = getReviews(1, db);
  expect(reviews).toHaveLength(1);
  // Both 7d and 30d reviews should be generated (log is 31 days old)
  expect(reviews[0].review_7d).toBeTruthy();
  expect(reviews[0].review_30d).toBeTruthy();
  // Review text should contain price comparison info
  expect(reviews[0].review_7d).toContain('浦发银行');
  expect(reviews[0].review_30d).toContain('浦发银行');

  db.close();
});
