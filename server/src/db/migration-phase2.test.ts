/**
 * 二期数据库迁移单元测试
 * Task 1.2
 */
import Database from 'better-sqlite3';
import { initializeDatabase } from './init';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

describe('Phase 2 Migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  test('所有二期新增表创建成功', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    const phase2Tables = [
      'valuation_cache',
      'rotation_status',
      'chain_status',
      'event_calendar',
      'deep_reports',
      'cycle_monitors',
      'market_environment',
      'daily_pick_tracking',
      'sentiment_index',
      'operation_logs',
      'notification_settings',
      'portfolio_snapshots',
      'user_settings',
    ];

    for (const table of phase2Tables) {
      expect(tableNames).toContain(table);
    }
  });

  test('positions 表新增 stop_loss_price 字段', () => {
    const cols = db.prepare('PRAGMA table_info(positions)').all() as { name: string; type: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('stop_loss_price');

    const slCol = cols.find(c => c.name === 'stop_loss_price');
    expect(slCol!.type).toBe('REAL');
  });

  test('users 表新增 last_login_at 字段', () => {
    const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    expect(cols.map(c => c.name)).toContain('last_login_at');
  });

  test('messages 表支持新消息类型插入', () => {
    db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1, 'test', 'hash')").run();

    const newTypes = [
      'stop_loss_alert',
      'rotation_switch',
      'chain_activation',
      'event_window',
      'cycle_bottom',
      'market_env_change',
      'daily_pick_tracking',
      'concentration_risk',
      'deep_report',
    ];

    for (const type of newTypes) {
      expect(() => {
        db.prepare(
          `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read)
           VALUES (1, ?, '600000', '测试', '测试摘要', '{}', 0)`
        ).run(type);
      }).not.toThrow();
    }

    const count = (db.prepare('SELECT COUNT(*) as c FROM messages').get() as any).c;
    expect(count).toBe(newTypes.length);
  });

  test('valuation_cache 表字段类型正确', () => {
    const cols = db.prepare('PRAGMA table_info(valuation_cache)').all() as { name: string; type: string }[];
    const colMap = Object.fromEntries(cols.map(c => [c.name, c.type]));

    expect(colMap['stock_code']).toBe('TEXT');
    expect(colMap['pe_value']).toBe('REAL');
    expect(colMap['pb_value']).toBe('REAL');
    expect(colMap['pe_percentile']).toBe('REAL');
    expect(colMap['pb_percentile']).toBe('REAL');
    expect(colMap['pe_zone']).toBe('TEXT');
    expect(colMap['pb_zone']).toBe('TEXT');
    expect(colMap['data_years']).toBe('INTEGER');
    expect(colMap['source']).toBe('TEXT');
  });

  test('cycle_monitors 表 UNIQUE 约束生效', () => {
    db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1, 'test', 'hash')").run();

    db.prepare(
      "INSERT INTO cycle_monitors (user_id, stock_code, stock_name, status, updated_at) VALUES (1, '600000', '浦发银行', 'falling', datetime('now'))"
    ).run();

    expect(() => {
      db.prepare(
        "INSERT INTO cycle_monitors (user_id, stock_code, stock_name, status, updated_at) VALUES (1, '600000', '浦发银行', 'rising', datetime('now'))"
      ).run();
    }).toThrow();
  });

  test('portfolio_snapshots 表 UNIQUE 约束生效', () => {
    db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1, 'test', 'hash')").run();

    db.prepare(
      "INSERT INTO portfolio_snapshots (user_id, snapshot_date, stock_code, stock_name, shares, cost_price, market_price, market_value, profit_loss) VALUES (1, '2025-01-01', '600000', '浦发银行', 100, 10, 12, 1200, 200)"
    ).run();

    expect(() => {
      db.prepare(
        "INSERT INTO portfolio_snapshots (user_id, snapshot_date, stock_code, stock_name, shares, cost_price, market_price, market_value, profit_loss) VALUES (1, '2025-01-01', '600000', '浦发银行', 200, 10, 12, 2400, 400)"
      ).run();
    }).toThrow();
  });

  test('迁移幂等性：多次执行不报错', () => {
    expect(() => {
      initializeDatabase(db);
      initializeDatabase(db);
    }).not.toThrow();
  });
});
