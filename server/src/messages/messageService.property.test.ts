import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import { getMessages, getMessageById, getUnreadCount } from './messageService';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function addUser(db: Database.Database, id: number) {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, `user${id}`, 'hash');
}

const validType = fc.constantFrom('scheduled_analysis', 'volatility_alert', 'self_correction', 'daily_pick', 'target_price_alert', 'ambush_recommendation');

function insertMessage(db: Database.Database, userId: number, type: string, isRead: number = 0) {
  db.prepare(
    `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read)
     VALUES (?, ?, '600000', '测试', '测试摘要', '{}', ?)`
  ).run(userId, type, isRead);
}

describe('属性测试：消息列表分页', () => {
  it('分页参数应正确限制返回数量', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 10 }),
        (totalMsgs, page, limit) => {
          const db = makeDb();
          addUser(db, 1);
          for (let i = 0; i < totalMsgs; i++) {
            insertMessage(db, 1, 'scheduled_analysis');
          }
          const result = getMessages(1, { page, limit }, db);
          const offset = (page - 1) * limit;
          const expected = Math.max(0, Math.min(limit, totalMsgs - offset));
          expect(result.messages.length).toBe(expected);
          expect(result.total).toBe(totalMsgs);
          expect(result.hasMore).toBe(offset + result.messages.length < totalMsgs);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('属性测试：消息类型过滤', () => {
  it('按类型过滤应只返回该类型的消息', () => {
    fc.assert(
      fc.property(validType, validType, (type1, type2) => {
        const db = makeDb();
        addUser(db, 1);
        insertMessage(db, 1, type1);
        insertMessage(db, 1, type2);

        const result = getMessages(1, { type: type1 }, db);
        for (const msg of result.messages) {
          expect(msg.type).toBe(type1);
        }
      }),
      { numRuns: 30 }
    );
  });
});

describe('属性测试：消息已读标记', () => {
  it('getMessageById 应自动标记消息为已读', () => {
    fc.assert(
      fc.property(validType, (type) => {
        const db = makeDb();
        addUser(db, 1);
        insertMessage(db, 1, type, 0);
        const msgId = (db.prepare('SELECT id FROM messages ORDER BY id DESC LIMIT 1').get() as any).id;

        const before = getUnreadCount(1, db);
        expect(before).toBe(1);

        const msg = getMessageById(1, msgId, db);
        expect(msg).not.toBeNull();
        expect(msg!.isRead).toBe(true);

        const after = getUnreadCount(1, db);
        expect(after).toBe(0);
      }),
      { numRuns: 20 }
    );
  });
});

describe('属性测试：未读消息计数', () => {
  it('未读计数应等于 is_read=0 的消息数', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        (unreadCount, readCount) => {
          const db = makeDb();
          addUser(db, 1);
          for (let i = 0; i < unreadCount; i++) {
            insertMessage(db, 1, 'scheduled_analysis', 0);
          }
          for (let i = 0; i < readCount; i++) {
            insertMessage(db, 1, 'scheduled_analysis', 1);
          }
          expect(getUnreadCount(1, db)).toBe(unreadCount);
        }
      ),
      { numRuns: 50 }
    );
  });
});
