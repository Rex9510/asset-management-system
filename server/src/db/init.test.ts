import Database from 'better-sqlite3';
import { initializeDatabase } from './init';

describe('Database Initialization', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('should create all required tables', () => {
    initializeDatabase(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);

    const expectedTables = [
      'ai_config',
      'analyses',
      'chat_messages',
      'hs300_constituents',
      'market_cache',
      'market_history',
      'messages',
      'news_cache',
      'positions',
      'technical_indicators',
      'users',
    ];

    for (const table of expectedTables) {
      expect(tableNames).toContain(table);
    }
  });

  test('should be idempotent (safe to run multiple times)', () => {
    initializeDatabase(db);
    initializeDatabase(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    expect(tables.length).toBeGreaterThanOrEqual(11);
  });

  test('users table should have correct columns', () => {
    initializeDatabase(db);

    const columns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('username');
    expect(colNames).toContain('password_hash');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('failed_login_count');
    expect(colNames).toContain('locked_until');
  });

  test('positions table should enforce foreign key to users', () => {
    initializeDatabase(db);

    expect(() => {
      db.prepare(
        "INSERT INTO positions (user_id, stock_code, stock_name, cost_price, shares, buy_date) VALUES (999, '600000', '浦发银行', 10.5, 100, '2024-01-01')"
      ).run();
    }).toThrow();
  });
});
