import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  getUserAccountAgeDays,
  getUserTrustLevel,
  filterActionByTrust,
  isNewUser,
  generateColdStartRecords,
  TrustLevel,
  ActionRef,
} from './trustService';

let testDb: Database.Database;

function setupTestDb() {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  initializeDatabase(testDb);
}

function createUserWithAge(daysAgo: number): number {
  const createdAt = new Date();
  createdAt.setDate(createdAt.getDate() - daysAgo);
  const result = testDb
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(`user_${daysAgo}_${Date.now()}`, 'hash', createdAt.toISOString());
  return result.lastInsertRowid as number;
}

describe('trustService', () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  describe('getUserAccountAgeDays', () => {
    it('should return 0 for a user created today', () => {
      const userId = createUserWithAge(0);
      expect(getUserAccountAgeDays(userId, testDb)).toBe(0);
    });

    it('should return correct age for a user created 10 days ago', () => {
      const userId = createUserWithAge(10);
      expect(getUserAccountAgeDays(userId, testDb)).toBe(10);
    });

    it('should return 0 for non-existent user', () => {
      expect(getUserAccountAgeDays(9999, testDb)).toBe(0);
    });

    it('should return correct age for a user created 45 days ago', () => {
      const userId = createUserWithAge(45);
      expect(getUserAccountAgeDays(userId, testDb)).toBe(45);
    });
  });

  describe('getUserTrustLevel', () => {
    it('should return level 1 for user created today', () => {
      const userId = createUserWithAge(0);
      expect(getUserTrustLevel(userId, testDb)).toBe(1);
    });

    it('should return level 1 for user created 6 days ago', () => {
      const userId = createUserWithAge(6);
      expect(getUserTrustLevel(userId, testDb)).toBe(1);
    });

    it('should return level 2 for user created 7 days ago', () => {
      const userId = createUserWithAge(7);
      expect(getUserTrustLevel(userId, testDb)).toBe(2);
    });

    it('should return level 2 for user created 29 days ago', () => {
      const userId = createUserWithAge(29);
      expect(getUserTrustLevel(userId, testDb)).toBe(2);
    });

    it('should return level 3 for user created 30 days ago', () => {
      const userId = createUserWithAge(30);
      expect(getUserTrustLevel(userId, testDb)).toBe(3);
    });

    it('should return level 3 for user created 100 days ago', () => {
      const userId = createUserWithAge(100);
      expect(getUserTrustLevel(userId, testDb)).toBe(3);
    });

    it('should return level 1 for non-existent user', () => {
      expect(getUserTrustLevel(9999, testDb)).toBe(1);
    });
  });

  describe('filterActionByTrust', () => {
    // Level 1: only hold and reduce
    it('should allow hold at level 1', () => {
      expect(filterActionByTrust('hold', 1)).toBe('hold');
    });

    it('should allow reduce at level 1', () => {
      expect(filterActionByTrust('reduce', 1)).toBe('reduce');
    });

    it('should downgrade add to hold at level 1', () => {
      expect(filterActionByTrust('add', 1)).toBe('hold');
    });

    it('should downgrade clear to reduce at level 1', () => {
      expect(filterActionByTrust('clear', 1)).toBe('reduce');
    });

    // Level 2: hold, reduce, clear
    it('should allow hold at level 2', () => {
      expect(filterActionByTrust('hold', 2)).toBe('hold');
    });

    it('should allow reduce at level 2', () => {
      expect(filterActionByTrust('reduce', 2)).toBe('reduce');
    });

    it('should allow clear at level 2', () => {
      expect(filterActionByTrust('clear', 2)).toBe('clear');
    });

    it('should downgrade add to hold at level 2', () => {
      expect(filterActionByTrust('add', 2)).toBe('hold');
    });

    // Level 3: all actions allowed
    it('should allow all actions at level 3', () => {
      const actions: ActionRef[] = ['hold', 'add', 'reduce', 'clear'];
      for (const action of actions) {
        expect(filterActionByTrust(action, 3)).toBe(action);
      }
    });
  });

  describe('isNewUser', () => {
    it('should return true for user created today', () => {
      const userId = createUserWithAge(0);
      expect(isNewUser(userId, testDb)).toBe(true);
    });

    it('should return true for user created 6 days ago', () => {
      const userId = createUserWithAge(6);
      expect(isNewUser(userId, testDb)).toBe(true);
    });

    it('should return false for user created 7 days ago', () => {
      const userId = createUserWithAge(7);
      expect(isNewUser(userId, testDb)).toBe(false);
    });

    it('should return false for user created 30 days ago', () => {
      const userId = createUserWithAge(30);
      expect(isNewUser(userId, testDb)).toBe(false);
    });

    it('should return true for non-existent user', () => {
      expect(isNewUser(9999, testDb)).toBe(true);
    });
  });

  describe('generateColdStartRecords', () => {
    it('should generate 3 backtest records for a new user', () => {
      const userId = createUserWithAge(0);
      generateColdStartRecords(userId, '600000', '浦发银行', testDb);

      const rows = testDb
        .prepare('SELECT * FROM analyses WHERE user_id = ? AND stock_code = ?')
        .all(userId, '600000');

      expect(rows).toHaveLength(3);
    });

    it('should only generate low-risk actions (hold/reduce)', () => {
      const userId = createUserWithAge(0);
      generateColdStartRecords(userId, '600000', '浦发银行', testDb);

      const rows = testDb
        .prepare('SELECT action_ref FROM analyses WHERE user_id = ? AND stock_code = ?')
        .all(userId, '600000') as { action_ref: string }[];

      for (const row of rows) {
        expect(['hold', 'reduce']).toContain(row.action_ref);
      }
    });

    it('should not generate records if user already has analyses', () => {
      const userId = createUserWithAge(0);

      // Insert an existing analysis
      testDb.prepare(
        `INSERT INTO analyses (
          user_id, stock_code, stock_name, trigger_type, stage,
          key_signals, action_ref, batch_plan, confidence, reasoning,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(userId, '600000', '浦发银行', 'manual', 'rising',
        '[]', 'hold', '[]', 70, 'test', new Date().toISOString());

      generateColdStartRecords(userId, '600000', '浦发银行', testDb);

      const rows = testDb
        .prepare('SELECT * FROM analyses WHERE user_id = ? AND stock_code = ?')
        .all(userId, '600000');

      // Should still be just the 1 existing record
      expect(rows).toHaveLength(1);
    });

    it('should include backtest data source', () => {
      const userId = createUserWithAge(0);
      generateColdStartRecords(userId, '600000', '浦发银行', testDb);

      const rows = testDb
        .prepare('SELECT data_sources FROM analyses WHERE user_id = ? AND stock_code = ?')
        .all(userId, '600000') as { data_sources: string }[];

      for (const row of rows) {
        const sources = JSON.parse(row.data_sources);
        expect(sources).toContain('backtest_data');
      }
    });

    it('should use 参考 compliant wording in reasoning', () => {
      const userId = createUserWithAge(0);
      generateColdStartRecords(userId, '600000', '浦发银行', testDb);

      const rows = testDb
        .prepare('SELECT reasoning FROM analyses WHERE user_id = ? AND stock_code = ?')
        .all(userId, '600000') as { reasoning: string }[];

      for (const row of rows) {
        expect(row.reasoning).toContain('参考方案');
        expect(row.reasoning).not.toContain('建议');
        expect(row.reasoning).not.toContain('推荐');
      }
    });
  });
});
