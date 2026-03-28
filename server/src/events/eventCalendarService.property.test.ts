/**
 * 事件日历属性测试
 * Tasks 13.3, 13.4, 13.5
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  calculateWindowStatus,
  createEvent,
  getEventById,
  updateEvent,
  deleteEvent,
  checkWindowChanges,
  WINDOW_LABELS,
  WindowStatus,
} from './eventCalendarService';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function addUser(db: Database.Database, id: number) {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, 'u' + id, 'h');
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Feature: ai-investment-assistant-phase2, Property 7: 事件窗口期计算正确性
// 验证需求：4.2
test('事件窗口期状态应与日期关系严格对应', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 30 }),  // beforeDays
      fc.integer({ min: 1, max: 30 }),  // afterDays
      fc.integer({ min: -60, max: 60 }), // dayOffset from event start
      (beforeDays, afterDays, dayOffset) => {
        const eventDate = new Date(Date.UTC(2025, 5, 15)); // 2025-06-15
        const eventEndDate = new Date(Date.UTC(2025, 5, 17)); // 2025-06-17 (2-day event)
        const today = new Date(eventDate.getTime() + dayOffset * 86400000);

        const status = calculateWindowStatus(
          dateStr(eventDate),
          dateStr(eventEndDate),
          beforeDays,
          afterDays,
          today
        );

        const beforeStart = new Date(eventDate.getTime() - beforeDays * 86400000);
        const afterEnd = new Date(eventEndDate.getTime() + afterDays * 86400000);
        const todayMs = today.getTime();

        if (todayMs >= beforeStart.getTime() && todayMs < eventDate.getTime()) {
          return status === 'before_build';
        }
        if (todayMs >= eventDate.getTime() && todayMs <= eventEndDate.getTime()) {
          return status === 'during_watch';
        }
        if (todayMs > eventEndDate.getTime() && todayMs <= afterEnd.getTime()) {
          return status === 'after_take_profit';
        }
        return status === 'none';
      }
    ),
    { numRuns: 200 }
  );
});

test('单日事件窗口期计算正确', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 15 }),  // beforeDays
      fc.integer({ min: 1, max: 15 }),  // afterDays
      fc.integer({ min: -30, max: 30 }), // dayOffset
      (beforeDays, afterDays, dayOffset) => {
        const eventDate = new Date(Date.UTC(2025, 8, 10)); // 2025-09-10
        const today = new Date(eventDate.getTime() + dayOffset * 86400000);

        const status = calculateWindowStatus(
          dateStr(eventDate),
          null, // single-day event
          beforeDays,
          afterDays,
          today
        );

        const beforeStart = new Date(eventDate.getTime() - beforeDays * 86400000);
        const afterEnd = new Date(eventDate.getTime() + afterDays * 86400000);
        const todayMs = today.getTime();

        if (todayMs >= beforeStart.getTime() && todayMs < eventDate.getTime()) {
          return status === 'before_build';
        }
        if (todayMs >= eventDate.getTime() && todayMs <= eventDate.getTime()) {
          return status === 'during_watch';
        }
        if (todayMs > eventDate.getTime() && todayMs <= afterEnd.getTime()) {
          return status === 'after_take_profit';
        }
        return status === 'none';
      }
    ),
    { numRuns: 200 }
  );
});


// Feature: ai-investment-assistant-phase2, Property 8: 事件日历CRUD往返
// 验证需求：4.7
test('创建事件后查询返回相同数据，更新后返回更新数据，删除后不存在', () => {
  const db = makeDb();

  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 20 }),  // name
      fc.constantFrom('financial_report', 'policy', 'exhibition', 'economic_data'), // category
      fc.integer({ min: 1, max: 15 }),  // beforeDays
      fc.integer({ min: 1, max: 15 }),  // afterDays
      (name, category, beforeDays, afterDays) => {
        const created = createEvent({
          name,
          eventDate: '2025-08-01',
          category,
          relatedSectors: ['科技', '消费'],
          beforeDays,
          afterDays,
        }, db);

        // Read back
        const fetched = getEventById(created.id, db);
        if (!fetched) return false;
        if (fetched.name !== name) return false;
        if (fetched.category !== category) return false;
        if (fetched.beforeDays !== beforeDays) return false;
        if (fetched.afterDays !== afterDays) return false;

        // Update
        const updated = updateEvent(created.id, { name: name + '_updated' }, db);
        if (!updated) return false;
        if (updated.name !== name + '_updated') return false;

        // Delete
        const deleted = deleteEvent(created.id, db);
        if (!deleted) return false;
        const afterDelete = getEventById(created.id, db);
        return afterDelete === null;
      }
    ),
    { numRuns: 30 }
  );

  db.close();
});

// Feature: ai-investment-assistant-phase2, Property 9: 事件窗口期变化触发通知
// 验证需求：4.4, 4.5
test('进入 before_build 或 after_take_profit 窗口时创建 event_window 消息', () => {
  const db = makeDb();
  addUser(db, 1);
  // Mark user as recently active
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = 1").run();

  // Create an event where today is in before_build window
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const eventDate = new Date(today.getTime() + 3 * 86400000); // 3 days from now
  const eventDateStr = dateStr(eventDate);

  createEvent({
    name: '测试事件',
    eventDate: eventDateStr,
    category: 'policy',
    relatedSectors: ['金融'],
    beforeDays: 5,
    afterDays: 3,
  }, db);

  // Run window change detection
  checkWindowChanges(db);

  // Should have created event_window message
  const msgs = db.prepare("SELECT * FROM messages WHERE type = 'event_window'").all() as any[];
  expect(msgs.length).toBeGreaterThanOrEqual(1);
  const msg = msgs[0];
  expect(msg.summary).toContain('测试事件');
  expect(msg.summary).toContain('事件前·可建仓');

  db.close();
});

test('checkWindowChanges 幂等性：同一天不重复创建消息', () => {
  const db = makeDb();
  addUser(db, 1);
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = 1").run();

  const today = new Date();
  const eventDate = new Date(today.getTime() + 3 * 86400000);

  createEvent({
    name: '幂等测试事件',
    eventDate: dateStr(eventDate),
    category: 'exhibition',
    relatedSectors: [],
    beforeDays: 5,
    afterDays: 3,
  }, db);

  checkWindowChanges(db);
  const count1 = (db.prepare("SELECT COUNT(*) as c FROM messages WHERE type = 'event_window'").get() as any).c;

  checkWindowChanges(db);
  const count2 = (db.prepare("SELECT COUNT(*) as c FROM messages WHERE type = 'event_window'").get() as any).c;

  expect(count2).toBe(count1); // No duplicate messages

  db.close();
});
