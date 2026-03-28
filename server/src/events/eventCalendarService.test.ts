import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  calculateWindowStatus,
  createEvent,
  getEventById,
  getEvents,
  updateEvent,
  deleteEvent,
  checkWindowChanges,
  WINDOW_LABELS,
} from './eventCalendarService';
import { seedEvents, SEED_EVENTS } from './seedEvents';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db);
  return db;
}

function seedUser(db: Database.Database, lastLoginRecent = true): number {
  const loginAt = lastLoginRecent
    ? new Date().toISOString()
    : new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO users (username, password_hash, last_login_at) VALUES (?, ?, ?)').run(
    `user_${Date.now()}_${Math.random()}`, 'hash', loginAt
  );
  return (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
}

/** Create a UTC date for testing */
function utc(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

describe('eventCalendarService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  // --- calculateWindowStatus (pure function) ---

  describe('calculateWindowStatus', () => {
    const eventDate = '2026-03-10';
    const eventEndDate = '2026-03-12';
    const beforeDays = 5;
    const afterDays = 3;

    it('should return before_build when today is within before_days before event', () => {
      // event_date - 5 = 2026-03-05, so 03-05 to 03-09 are before_build
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-03-05'))).toBe('before_build');
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-03-09'))).toBe('before_build');
    });

    it('should return during_watch when today is within event dates', () => {
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-03-10'))).toBe('during_watch');
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-03-11'))).toBe('during_watch');
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-03-12'))).toBe('during_watch');
    });

    it('should return after_take_profit when today is within after_days after event end', () => {
      // event_end + 3 = 2026-03-15, so 03-13 to 03-15 are after_take_profit
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-03-13'))).toBe('after_take_profit');
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-03-15'))).toBe('after_take_profit');
    });

    it('should return none when today is outside all windows', () => {
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-03-01'))).toBe('none');
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-03-16'))).toBe('none');
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-06-01'))).toBe('none');
    });

    it('should treat single-day event (null eventEndDate) correctly', () => {
      // Single-day event on 2026-03-10, beforeDays=5, afterDays=3
      expect(calculateWindowStatus('2026-03-10', null, 5, 3, utc('2026-03-05'))).toBe('before_build');
      expect(calculateWindowStatus('2026-03-10', null, 5, 3, utc('2026-03-10'))).toBe('during_watch');
      expect(calculateWindowStatus('2026-03-10', null, 5, 3, utc('2026-03-11'))).toBe('after_take_profit');
      expect(calculateWindowStatus('2026-03-10', null, 5, 3, utc('2026-03-13'))).toBe('after_take_profit');
      expect(calculateWindowStatus('2026-03-10', null, 5, 3, utc('2026-03-14'))).toBe('none');
    });

    it('should handle boundary: exact start of before_build window', () => {
      // beforeDays=5, eventDate=03-10 → before_build starts 03-05
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-03-04'))).toBe('none');
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-03-05'))).toBe('before_build');
    });

    it('should handle boundary: exact end of after_take_profit window', () => {
      // afterDays=3, eventEndDate=03-12 → after_take_profit ends 03-15
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-03-15'))).toBe('after_take_profit');
      expect(calculateWindowStatus(eventDate, eventEndDate, beforeDays, afterDays, utc('2026-03-16'))).toBe('none');
    });

    it('should handle zero beforeDays and afterDays', () => {
      expect(calculateWindowStatus('2026-03-10', '2026-03-12', 0, 0, utc('2026-03-09'))).toBe('none');
      expect(calculateWindowStatus('2026-03-10', '2026-03-12', 0, 0, utc('2026-03-10'))).toBe('during_watch');
      expect(calculateWindowStatus('2026-03-10', '2026-03-12', 0, 0, utc('2026-03-12'))).toBe('during_watch');
      expect(calculateWindowStatus('2026-03-10', '2026-03-12', 0, 0, utc('2026-03-13'))).toBe('none');
    });
  });

  // --- WINDOW_LABELS ---

  describe('WINDOW_LABELS', () => {
    it('should have correct Chinese labels', () => {
      expect(WINDOW_LABELS.before_build).toBe('事件前·可建仓');
      expect(WINDOW_LABELS.during_watch).toBe('事件中·观望');
      expect(WINDOW_LABELS.after_take_profit).toBe('利好兑现·可减仓');
      expect(WINDOW_LABELS.none).toBe('');
    });
  });

  // --- CRUD: createEvent ---

  describe('createEvent', () => {
    it('should create an event and return it with window status', () => {
      const event = createEvent({
        name: '测试事件',
        eventDate: '2026-06-01',
        eventEndDate: '2026-06-03',
        category: 'policy',
        relatedSectors: ['科技', '金融'],
        beforeDays: 5,
        afterDays: 3,
        tip: '测试提示',
      }, db);

      expect(event.id).toBeGreaterThan(0);
      expect(event.name).toBe('测试事件');
      expect(event.eventDate).toBe('2026-06-01');
      expect(event.eventEndDate).toBe('2026-06-03');
      expect(event.category).toBe('policy');
      expect(event.relatedSectors).toEqual(['科技', '金融']);
      expect(event.beforeDays).toBe(5);
      expect(event.afterDays).toBe(3);
      expect(event.tip).toBe('测试提示');
      expect(['before_build', 'during_watch', 'after_take_profit', 'none']).toContain(event.windowStatus);
    });

    it('should create event without optional fields', () => {
      const event = createEvent({
        name: '简单事件',
        eventDate: '2026-06-01',
        category: 'exhibition',
        relatedSectors: [],
        beforeDays: 3,
        afterDays: 2,
      }, db);

      expect(event.id).toBeGreaterThan(0);
      expect(event.eventEndDate).toBeNull();
      expect(event.tip).toBeNull();
      expect(event.relatedSectors).toEqual([]);
    });
  });

  // --- CRUD: getEventById ---

  describe('getEventById', () => {
    it('should return event by id', () => {
      const created = createEvent({
        name: '查询事件',
        eventDate: '2026-07-01',
        category: 'financial_report',
        relatedSectors: ['全行业'],
        beforeDays: 10,
        afterDays: 5,
      }, db);

      const found = getEventById(created.id, db);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('查询事件');
    });

    it('should return null for non-existent id', () => {
      expect(getEventById(9999, db)).toBeNull();
    });
  });

  // --- CRUD: updateEvent ---

  describe('updateEvent', () => {
    it('should update event fields', () => {
      const created = createEvent({
        name: '原始事件',
        eventDate: '2026-08-01',
        category: 'policy',
        relatedSectors: ['基建'],
        beforeDays: 5,
        afterDays: 3,
        tip: '原始提示',
      }, db);

      const updated = updateEvent(created.id, {
        name: '更新事件',
        tip: '更新提示',
        relatedSectors: ['基建', '环保'],
      }, db);

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('更新事件');
      expect(updated!.tip).toBe('更新提示');
      expect(updated!.relatedSectors).toEqual(['基建', '环保']);
      // Unchanged fields
      expect(updated!.eventDate).toBe('2026-08-01');
      expect(updated!.category).toBe('policy');
    });

    it('should return null for non-existent id', () => {
      expect(updateEvent(9999, { name: 'nope' }, db)).toBeNull();
    });
  });

  // --- CRUD: deleteEvent ---

  describe('deleteEvent', () => {
    it('should delete event and return true', () => {
      const created = createEvent({
        name: '删除事件',
        eventDate: '2026-09-01',
        category: 'exhibition',
        relatedSectors: [],
        beforeDays: 3,
        afterDays: 2,
      }, db);

      expect(deleteEvent(created.id, db)).toBe(true);
      expect(getEventById(created.id, db)).toBeNull();
    });

    it('should return false for non-existent id', () => {
      expect(deleteEvent(9999, db)).toBe(false);
    });
  });

  // --- getEvents ---

  describe('getEvents', () => {
    it('should return events within the window period', () => {
      // Create an event that is currently in before_build window
      const today = new Date();
      const eventDate = new Date(today.getTime() + 3 * 86400000);
      const eventDateStr = eventDate.toISOString().slice(0, 10);

      createEvent({
        name: '近期事件',
        eventDate: eventDateStr,
        category: 'policy',
        relatedSectors: ['科技'],
        beforeDays: 5,
        afterDays: 3,
      }, db);

      const events = getEvents(7, db);
      expect(events.length).toBe(1);
      expect(events[0].name).toBe('近期事件');
      expect(events[0].windowStatus).toBe('before_build');
      expect(events[0].windowLabel).toBe('事件前·可建仓');
    });

    it('should not return events outside the window', () => {
      // Create a far-future event
      createEvent({
        name: '远期事件',
        eventDate: '2030-01-01',
        category: 'policy',
        relatedSectors: [],
        beforeDays: 5,
        afterDays: 3,
      }, db);

      const events = getEvents(7, db);
      expect(events.length).toBe(0);
    });

    it('should return events currently during_watch', () => {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const endDate = new Date(today.getTime() + 2 * 86400000);
      const endDateStr = endDate.toISOString().slice(0, 10);

      createEvent({
        name: '进行中事件',
        eventDate: todayStr,
        eventEndDate: endDateStr,
        category: 'exhibition',
        relatedSectors: ['消费'],
        beforeDays: 5,
        afterDays: 3,
      }, db);

      const events = getEvents(7, db);
      expect(events.length).toBe(1);
      expect(events[0].windowStatus).toBe('during_watch');
      expect(events[0].windowLabel).toBe('事件中·观望');
    });
  });

  // --- checkWindowChanges ---

  describe('checkWindowChanges', () => {
    it('should create event_window messages for before_build events', () => {
      const userId = seedUser(db);

      // Create event starting 3 days from now (within beforeDays=5)
      const today = new Date();
      const eventDate = new Date(today.getTime() + 3 * 86400000);
      const eventDateStr = eventDate.toISOString().slice(0, 10);

      createEvent({
        name: '即将到来的事件',
        eventDate: eventDateStr,
        category: 'policy',
        relatedSectors: ['科技'],
        beforeDays: 5,
        afterDays: 3,
      }, db);

      checkWindowChanges(db);

      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'event_window'`
      ).all() as { user_id: number; stock_name: string; summary: string; detail: string }[];

      expect(messages.length).toBe(1);
      expect(messages[0].user_id).toBe(userId);
      expect(messages[0].stock_name).toBe('即将到来的事件');
      expect(messages[0].summary).toContain('事件前·可建仓');

      const detail = JSON.parse(messages[0].detail);
      expect(detail.windowStatus).toBe('before_build');
      expect(detail.windowLabel).toBe('事件前·可建仓');
    });

    it('should create event_window messages for after_take_profit events', () => {
      const userId = seedUser(db);

      // Create event that ended yesterday (within afterDays=3)
      const today = new Date();
      const eventDate = new Date(today.getTime() - 3 * 86400000);
      const eventEndDate = new Date(today.getTime() - 1 * 86400000);

      createEvent({
        name: '已结束事件',
        eventDate: eventDate.toISOString().slice(0, 10),
        eventEndDate: eventEndDate.toISOString().slice(0, 10),
        category: 'financial_report',
        relatedSectors: ['全行业'],
        beforeDays: 5,
        afterDays: 3,
      }, db);

      checkWindowChanges(db);

      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'event_window'`
      ).all() as { summary: string }[];

      expect(messages.length).toBe(1);
      expect(messages[0].summary).toContain('利好兑现·可减仓');
    });

    it('should not create messages for during_watch events', () => {
      seedUser(db);

      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const endDate = new Date(today.getTime() + 5 * 86400000);

      createEvent({
        name: '进行中事件',
        eventDate: todayStr,
        eventEndDate: endDate.toISOString().slice(0, 10),
        category: 'exhibition',
        relatedSectors: [],
        beforeDays: 5,
        afterDays: 3,
      }, db);

      checkWindowChanges(db);

      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'event_window'`
      ).all();
      expect(messages.length).toBe(0);
    });

    it('should be idempotent — no duplicate messages on same day', () => {
      seedUser(db);

      const today = new Date();
      const eventDate = new Date(today.getTime() + 3 * 86400000);

      createEvent({
        name: '幂等测试事件',
        eventDate: eventDate.toISOString().slice(0, 10),
        category: 'policy',
        relatedSectors: [],
        beforeDays: 5,
        afterDays: 3,
      }, db);

      checkWindowChanges(db);
      checkWindowChanges(db);

      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'event_window'`
      ).all();
      expect(messages.length).toBe(1);
    });

    it('should send messages to multiple active users', () => {
      const user1 = seedUser(db, true);
      const user2 = seedUser(db, true);
      seedUser(db, false); // inactive user

      const today = new Date();
      const eventDate = new Date(today.getTime() + 3 * 86400000);

      createEvent({
        name: '多用户事件',
        eventDate: eventDate.toISOString().slice(0, 10),
        category: 'policy',
        relatedSectors: [],
        beforeDays: 5,
        afterDays: 3,
      }, db);

      checkWindowChanges(db);

      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'event_window'`
      ).all() as { user_id: number }[];

      expect(messages.length).toBe(2);
      const userIds = messages.map(m => m.user_id).sort();
      expect(userIds).toEqual([user1, user2].sort());
    });
  });

  // --- seedEvents ---

  describe('seedEvents', () => {
    it('should import seed events on first call', () => {
      seedEvents(db);

      const count = db.prepare('SELECT COUNT(*) as cnt FROM event_calendar WHERE is_seed = 1').get() as { cnt: number };
      expect(count.cnt).toBe(SEED_EVENTS.length);
    });

    it('should be idempotent — second call does not duplicate', () => {
      seedEvents(db);
      seedEvents(db);

      const count = db.prepare('SELECT COUNT(*) as cnt FROM event_calendar WHERE is_seed = 1').get() as { cnt: number };
      expect(count.cnt).toBe(SEED_EVENTS.length);
    });

    it('should set is_seed=1 for all seed events', () => {
      seedEvents(db);

      const nonSeed = db.prepare('SELECT COUNT(*) as cnt FROM event_calendar WHERE is_seed != 1').get() as { cnt: number };
      expect(nonSeed.cnt).toBe(0);
    });

    it('should include expected events', () => {
      seedEvents(db);

      const names = db.prepare('SELECT DISTINCT name FROM event_calendar WHERE is_seed = 1').all() as { name: string }[];
      const nameSet = new Set(names.map(n => n.name));

      expect(nameSet.has('全国两会')).toBe(true);
      expect(nameSet.has('中报披露期')).toBe(true);
      expect(nameSet.has('双十一购物节')).toBe(true);
      expect(nameSet.has('中央经济工作会议')).toBe(true);
    });

    it('should store related_sectors as JSON string', () => {
      seedEvents(db);

      const row = db.prepare(
        `SELECT related_sectors FROM event_calendar WHERE name = '全国两会' LIMIT 1`
      ).get() as { related_sectors: string };

      const sectors = JSON.parse(row.related_sectors);
      expect(sectors).toEqual(['基建', '环保', '科技']);
    });
  });
});
