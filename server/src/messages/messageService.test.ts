import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';

let testDb: Database.Database;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

import { getMessages, getMessageById, getUnreadCount } from './messageService';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function createUser(db: Database.Database, username = 'testuser'): number {
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, 'hash123');
  return (db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number }).id;
}

function insertMessage(
  db: Database.Database,
  userId: number,
  overrides: Partial<{
    type: string;
    stockCode: string;
    stockName: string;
    summary: string;
    detail: string;
    isRead: number;
    createdAt: string;
  }> = {}
): number {
  const {
    type = 'scheduled_analysis',
    stockCode = '600000',
    stockName = '浦发银行',
    summary = '测试摘要',
    detail = '测试详情',
    isRead = 0,
    createdAt = new Date().toISOString(),
  } = overrides;
  const result = db.prepare(
    'INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, type, stockCode, stockName, summary, detail, isRead, createdAt);
  return result.lastInsertRowid as number;
}

describe('messageService', () => {
  let userId: number;

  beforeEach(() => {
    testDb = makeDb();
    userId = createUser(testDb);
  });

  afterEach(() => {
    testDb.close();
  });

  describe('getMessages', () => {
    it('should return empty result when no messages', () => {
      const result = getMessages(userId, {}, testDb);
      expect(result.messages).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('should return messages ordered by created_at DESC', () => {
      insertMessage(testDb, userId, { summary: '旧消息', createdAt: '2024-01-01T00:00:00Z' });
      insertMessage(testDb, userId, { summary: '新消息', createdAt: '2024-01-02T00:00:00Z' });

      const result = getMessages(userId, {}, testDb);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].summary).toBe('新消息');
      expect(result.messages[1].summary).toBe('旧消息');
    });

    it('should filter by type', () => {
      insertMessage(testDb, userId, { type: 'scheduled_analysis' });
      insertMessage(testDb, userId, { type: 'volatility_alert' });
      insertMessage(testDb, userId, { type: 'daily_pick' });

      const result = getMessages(userId, { type: 'volatility_alert' }, testDb);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('volatility_alert');
      expect(result.total).toBe(1);
    });

    it('should throw on invalid type', () => {
      expect(() => getMessages(userId, { type: 'invalid_type' }, testDb)).toThrow('无效的消息类型');
    });

    it('should paginate correctly', () => {
      for (let i = 0; i < 5; i++) {
        insertMessage(testDb, userId, { summary: `消息${i}`, createdAt: `2024-01-0${i + 1}T00:00:00Z` });
      }

      const page1 = getMessages(userId, { page: 1, limit: 2 }, testDb);
      expect(page1.messages).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);

      const page2 = getMessages(userId, { page: 2, limit: 2 }, testDb);
      expect(page2.messages).toHaveLength(2);
      expect(page2.hasMore).toBe(true);

      const page3 = getMessages(userId, { page: 3, limit: 2 }, testDb);
      expect(page3.messages).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
    });

    it('should default to page 1 and limit 20', () => {
      for (let i = 0; i < 25; i++) {
        insertMessage(testDb, userId, { summary: `消息${i}` });
      }

      const result = getMessages(userId, {}, testDb);
      expect(result.messages).toHaveLength(20);
      expect(result.total).toBe(25);
      expect(result.hasMore).toBe(true);
    });

    it('should not return other user messages', () => {
      const otherUserId = createUser(testDb, 'otheruser');
      insertMessage(testDb, userId, { summary: '我的消息' });
      insertMessage(testDb, otherUserId, { summary: '别人的消息' });

      const result = getMessages(userId, {}, testDb);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].summary).toBe('我的消息');
    });

    it('should map fields correctly', () => {
      insertMessage(testDb, userId, {
        type: 'daily_pick',
        stockCode: '000001',
        stockName: '平安银行',
        summary: '每日精选',
        detail: '详细分析',
        isRead: 1,
      });

      const result = getMessages(userId, {}, testDb);
      const msg = result.messages[0];
      expect(msg.type).toBe('daily_pick');
      expect(msg.stockCode).toBe('000001');
      expect(msg.stockName).toBe('平安银行');
      expect(msg.summary).toBe('每日精选');
      expect(msg.detail).toBe('详细分析');
      expect(msg.isRead).toBe(true);
    });
  });

  describe('getMessageById', () => {
    it('should return message and mark as read', () => {
      const msgId = insertMessage(testDb, userId, { summary: '测试消息' });

      const msg = getMessageById(userId, msgId, testDb);
      expect(msg).not.toBeNull();
      expect(msg!.id).toBe(msgId);
      expect(msg!.summary).toBe('测试消息');
      expect(msg!.isRead).toBe(true);

      // Verify DB was updated
      const row = testDb.prepare('SELECT is_read FROM messages WHERE id = ?').get(msgId) as { is_read: number };
      expect(row.is_read).toBe(1);
    });

    it('should return null for non-existent message', () => {
      const msg = getMessageById(userId, 999, testDb);
      expect(msg).toBeNull();
    });

    it('should not return other user message', () => {
      const otherUserId = createUser(testDb, 'otheruser');
      const msgId = insertMessage(testDb, otherUserId, { summary: '别人的消息' });

      const msg = getMessageById(userId, msgId, testDb);
      expect(msg).toBeNull();
    });

    it('should not re-update already read message', () => {
      const msgId = insertMessage(testDb, userId, { isRead: 1 });

      const msg = getMessageById(userId, msgId, testDb);
      expect(msg).not.toBeNull();
      expect(msg!.isRead).toBe(true);
    });
  });

  describe('getUnreadCount', () => {
    it('should return 0 when no messages', () => {
      expect(getUnreadCount(userId, testDb)).toBe(0);
    });

    it('should count only unread messages', () => {
      insertMessage(testDb, userId, { isRead: 0 });
      insertMessage(testDb, userId, { isRead: 0 });
      insertMessage(testDb, userId, { isRead: 1 });

      expect(getUnreadCount(userId, testDb)).toBe(2);
    });

    it('should not count other user messages', () => {
      const otherUserId = createUser(testDb, 'otheruser');
      insertMessage(testDb, userId, { isRead: 0 });
      insertMessage(testDb, otherUserId, { isRead: 0 });

      expect(getUnreadCount(userId, testDb)).toBe(1);
    });

    it('should decrease after reading a message', () => {
      const msgId = insertMessage(testDb, userId, { isRead: 0 });
      insertMessage(testDb, userId, { isRead: 0 });

      expect(getUnreadCount(userId, testDb)).toBe(2);

      getMessageById(userId, msgId, testDb);

      expect(getUnreadCount(userId, testDb)).toBe(1);
    });
  });
});
