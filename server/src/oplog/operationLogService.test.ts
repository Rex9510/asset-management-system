import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  logOperation,
  getOperationLogs,
  generateReviews,
  getReviews,
  OperationLog,
} from './operationLogService';

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

function insertMarketCache(db: Database.Database, stockCode: string, price: number): void {
  db.prepare(
    `INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at)
     VALUES (?, ?, ?, 0, 1000000, datetime('now'))`
  ).run(stockCode, stockCode, price);
}

/**
 * Insert an operation log with a custom created_at timestamp for testing time-based reviews.
 */
function insertLogWithDate(
  db: Database.Database,
  userId: number,
  stockCode: string,
  stockName: string,
  price: number,
  daysAgo: number
): number {
  const result = db.prepare(
    `INSERT INTO operation_logs (user_id, operation_type, stock_code, stock_name, price, shares, created_at)
     VALUES (?, 'create', ?, ?, ?, 100, datetime('now', '-${daysAgo} days'))`
  ).run(userId, stockCode, stockName, price);
  return result.lastInsertRowid as number;
}


beforeEach(() => {
  testDb = makeDb();
  insertUser(testDb, 1);
});

afterEach(() => {
  testDb.close();
});

// --- logOperation ---

describe('logOperation', () => {
  it('should create an operation log record', () => {
    logOperation(
      {
        userId: 1,
        operationType: 'create',
        stockCode: '600000',
        stockName: '浦发银行',
        price: 10.5,
        shares: 100,
        aiSummary: '参考方案：持有观望',
      },
      testDb
    );

    const row = testDb
      .prepare('SELECT * FROM operation_logs WHERE user_id = 1')
      .get() as OperationLog;

    expect(row).toBeDefined();
    expect(row.operation_type).toBe('create');
    expect(row.stock_code).toBe('600000');
    expect(row.stock_name).toBe('浦发银行');
    expect(row.price).toBe(10.5);
    expect(row.shares).toBe(100);
    expect(row.ai_summary).toBe('参考方案：持有观望');
    expect(row.review_7d).toBeNull();
    expect(row.review_30d).toBeNull();
    expect(row.created_at).toBeDefined();
  });

  it('should create a record with optional fields as null', () => {
    logOperation(
      {
        userId: 1,
        operationType: 'delete',
        stockCode: '300001',
        stockName: '特锐德',
      },
      testDb
    );

    const row = testDb
      .prepare('SELECT * FROM operation_logs WHERE user_id = 1')
      .get() as OperationLog;

    expect(row.price).toBeNull();
    expect(row.shares).toBeNull();
    expect(row.ai_summary).toBeNull();
  });
});

// --- getOperationLogs ---

describe('getOperationLogs', () => {
  it('should return paginated logs ordered by created_at DESC', () => {
    // Insert 3 logs with different timestamps
    for (let i = 1; i <= 3; i++) {
      insertLogWithDate(testDb, 1, '600000', '浦发银行', 10 + i, i);
    }

    const result = getOperationLogs(1, 1, 2, testDb);

    expect(result.total).toBe(3);
    expect(result.logs).toHaveLength(2);
    // Most recent first (1 day ago before 2 days ago)
    expect(result.logs[0].price).toBe(11); // 1 day ago
    expect(result.logs[1].price).toBe(12); // 2 days ago
  });

  it('should return second page correctly', () => {
    for (let i = 1; i <= 3; i++) {
      insertLogWithDate(testDb, 1, '600000', '浦发银行', 10 + i, i);
    }

    const result = getOperationLogs(1, 2, 2, testDb);

    expect(result.total).toBe(3);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].price).toBe(13); // 3 days ago, oldest
  });

  it('should return empty when user has no logs', () => {
    const result = getOperationLogs(1, 1, 10, testDb);
    expect(result.total).toBe(0);
    expect(result.logs).toHaveLength(0);
  });

  it('should not return logs from other users', () => {
    insertUser(testDb, 2);
    insertLogWithDate(testDb, 2, '600000', '浦发银行', 10, 1);

    const result = getOperationLogs(1, 1, 10, testDb);
    expect(result.total).toBe(0);
  });
});

// --- generateReviews ---

describe('generateReviews', () => {
  it('should generate 7d review text when log is older than 7 days', () => {
    const logId = insertLogWithDate(testDb, 1, '600000', '浦发银行', 10.0, 8);
    insertMarketCache(testDb, '600000', 11.0);

    generateReviews(testDb);

    const log = testDb
      .prepare('SELECT * FROM operation_logs WHERE id = ?')
      .get(logId) as OperationLog;

    expect(log.review_7d).toBe(
      '操作后7天，浦发银行价格从10元变为11元，涨跌幅10.00%'
    );
    expect(log.review_7d_at).not.toBeNull();
    // 30d review should still be null (only 8 days old)
    expect(log.review_30d).toBeNull();
  });

  it('should generate 30d review text when log is older than 30 days', () => {
    const logId = insertLogWithDate(testDb, 1, '600000', '浦发银行', 20.0, 31);
    insertMarketCache(testDb, '600000', 18.0);

    generateReviews(testDb);

    const log = testDb
      .prepare('SELECT * FROM operation_logs WHERE id = ?')
      .get(logId) as OperationLog;

    expect(log.review_30d).toBe(
      '操作后30天，浦发银行价格从20元变为18元，涨跌幅-10.00%'
    );
    expect(log.review_30d_at).not.toBeNull();
  });

  it('should generate both 7d and 30d reviews for old logs', () => {
    const logId = insertLogWithDate(testDb, 1, '600000', '浦发银行', 10.0, 35);
    insertMarketCache(testDb, '600000', 12.0);

    generateReviews(testDb);

    const log = testDb
      .prepare('SELECT * FROM operation_logs WHERE id = ?')
      .get(logId) as OperationLog;

    expect(log.review_7d).toContain('操作后7天');
    expect(log.review_30d).toContain('操作后30天');
  });

  it('should use neutral wording with no criticism', () => {
    const logId = insertLogWithDate(testDb, 1, '600000', '浦发银行', 10.0, 8);
    insertMarketCache(testDb, '600000', 5.0); // 50% loss

    generateReviews(testDb);

    const log = testDb
      .prepare('SELECT * FROM operation_logs WHERE id = ?')
      .get(logId) as OperationLog;

    const reviewText = log.review_7d!;
    // Neutral template — no blame words
    expect(reviewText).not.toMatch(/错误|失误|亏损|不应该|糟糕|差劲|批评|指责/);
    expect(reviewText).toContain('操作后7天');
    expect(reviewText).toContain('浦发银行');
    expect(reviewText).toContain('涨跌幅');
  });

  it('should set review to fallback text when no market data available', () => {
    const logId = insertLogWithDate(testDb, 1, '600000', '浦发银行', 10.0, 8);
    // No market cache inserted

    generateReviews(testDb);

    const log = testDb
      .prepare('SELECT * FROM operation_logs WHERE id = ?')
      .get(logId) as OperationLog;

    expect(log.review_7d).toBe('暂无最新行情数据');
  });

  it('should not regenerate existing reviews', () => {
    const logId = insertLogWithDate(testDb, 1, '600000', '浦发银行', 10.0, 8);
    insertMarketCache(testDb, '600000', 11.0);

    generateReviews(testDb);

    // Change market price
    insertMarketCache(testDb, '600000', 15.0);

    generateReviews(testDb);

    const log = testDb
      .prepare('SELECT * FROM operation_logs WHERE id = ?')
      .get(logId) as OperationLog;

    // Should still have the original review (11, not 15)
    expect(log.review_7d).toContain('11元');
  });

  it('should skip logs without price', () => {
    testDb.prepare(
      `INSERT INTO operation_logs (user_id, operation_type, stock_code, stock_name, price, shares, created_at)
       VALUES (1, 'delete', '600000', '浦发银行', NULL, NULL, datetime('now', '-8 days'))`
    ).run();

    insertMarketCache(testDb, '600000', 11.0);

    generateReviews(testDb);

    const log = testDb
      .prepare('SELECT * FROM operation_logs WHERE user_id = 1')
      .get() as OperationLog;

    expect(log.review_7d).toBeNull();
  });
});

// --- getReviews ---

describe('getReviews', () => {
  it('should return only logs with at least one review', () => {
    // Log with review
    const logId1 = insertLogWithDate(testDb, 1, '600000', '浦发银行', 10.0, 8);
    insertMarketCache(testDb, '600000', 11.0);
    generateReviews(testDb);

    // Log without review (too recent)
    insertLogWithDate(testDb, 1, '300001', '特锐德', 20.0, 2);

    const reviews = getReviews(1, testDb);

    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe(logId1);
    expect(reviews[0].review_7d).not.toBeNull();
  });

  it('should return empty when no reviews exist', () => {
    insertLogWithDate(testDb, 1, '600000', '浦发银行', 10.0, 2);

    const reviews = getReviews(1, testDb);
    expect(reviews).toHaveLength(0);
  });

  it('should not return reviews from other users', () => {
    insertUser(testDb, 2);
    insertLogWithDate(testDb, 2, '600000', '浦发银行', 10.0, 8);
    insertMarketCache(testDb, '600000', 11.0);
    generateReviews(testDb);

    const reviews = getReviews(1, testDb);
    expect(reviews).toHaveLength(0);
  });
});
