/**
 * 事件驱动日历服务
 *
 * 纯规则引擎，零AI调用。
 * CRUD操作 + 窗口期计算 + 窗口状态变化消息创建。
 *
 * 窗口期逻辑：
 * - before_build: today >= eventDate - beforeDays AND today < eventDate → "事件前·可建仓"
 * - during_watch: today >= eventDate AND today <= eventEndDate → "事件中·观望"
 * - after_take_profit: today > eventEndDate AND today <= eventEndDate + afterDays → "利好兑现·可减仓"
 * - none: 其他
 */
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';

// --- Types ---

export type WindowStatus = 'before_build' | 'during_watch' | 'after_take_profit' | 'none';

export interface EventRow {
  id: number;
  name: string;
  event_date: string;
  event_end_date: string | null;
  category: string;
  related_sectors: string | null;
  before_days: number;
  after_days: number;
  tip: string | null;
  is_seed: number;
  created_at: string;
  updated_at: string;
}

export interface EventResponse {
  id: number;
  name: string;
  eventDate: string;
  eventEndDate: string | null;
  category: string;
  relatedSectors: string[];
  windowStatus: WindowStatus;
  windowLabel: string;
  tip: string | null;
  beforeDays: number;
  afterDays: number;
}

export interface CreateEventData {
  name: string;
  eventDate: string;
  eventEndDate?: string;
  category: string;
  relatedSectors: string[];
  beforeDays: number;
  afterDays: number;
  tip?: string;
}

export interface UpdateEventData {
  name?: string;
  eventDate?: string;
  eventEndDate?: string | null;
  category?: string;
  relatedSectors?: string[];
  beforeDays?: number;
  afterDays?: number;
  tip?: string | null;
}

// --- Constants ---

export const WINDOW_LABELS: Record<WindowStatus, string> = {
  before_build: '事件前·可建仓',
  during_watch: '事件中·观望',
  after_take_profit: '利好兑现·可减仓',
  none: '',
};

// --- Helper: parse date string to Date at midnight UTC ---

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}


// --- Core: Window Status Calculation (pure function) ---

/**
 * Calculate the window status for an event given today's date.
 * Pure function — no DB or side effects.
 */
export function calculateWindowStatus(
  eventDate: string,
  eventEndDate: string | null,
  beforeDays: number,
  afterDays: number,
  today?: Date
): WindowStatus {
  const t = today ?? todayUTC();
  const todayMs = t.getTime();

  const start = parseDate(eventDate);
  const end = eventEndDate ? parseDate(eventEndDate) : parseDate(eventDate);

  const beforeStart = new Date(start.getTime() - beforeDays * 86400000);
  const afterEnd = new Date(end.getTime() + afterDays * 86400000);

  if (todayMs >= beforeStart.getTime() && todayMs < start.getTime()) {
    return 'before_build';
  }
  if (todayMs >= start.getTime() && todayMs <= end.getTime()) {
    return 'during_watch';
  }
  if (todayMs > end.getTime() && todayMs <= afterEnd.getTime()) {
    return 'after_take_profit';
  }
  return 'none';
}

// --- Helper: convert DB row to API response ---

function toResponse(row: EventRow, today?: Date): EventResponse {
  const windowStatus = calculateWindowStatus(
    row.event_date,
    row.event_end_date,
    row.before_days,
    row.after_days,
    today
  );

  let relatedSectors: string[] = [];
  if (row.related_sectors) {
    try {
      relatedSectors = JSON.parse(row.related_sectors);
    } catch {
      relatedSectors = [];
    }
  }

  return {
    id: row.id,
    name: row.name,
    eventDate: row.event_date,
    eventEndDate: row.event_end_date,
    category: row.category,
    relatedSectors,
    windowStatus,
    windowLabel: WINDOW_LABELS[windowStatus],
    tip: row.tip,
    beforeDays: row.before_days,
    afterDays: row.after_days,
  };
}

// --- CRUD Operations ---

/**
 * Get events within N days from today (default 30).
 * Returns events whose window period overlaps with [today, today + days].
 */
export function getEvents(days: number = 30, db?: Database.Database): EventResponse[] {
  const database = db || getDatabase();
  const today = todayUTC();
  const futureDate = new Date(today.getTime() + days * 86400000);

  // Select events that could be relevant:
  // An event is relevant if its extended window [eventDate - beforeDays, eventEndDate + afterDays]
  // overlaps with [today, today + days]
  const rows = database.prepare(
    `SELECT * FROM event_calendar
     WHERE date(event_date, '-' || before_days || ' days') <= ?
       AND date(COALESCE(event_end_date, event_date), '+' || after_days || ' days') >= ?
     ORDER BY event_date ASC`
  ).all(toDateStr(futureDate), toDateStr(today)) as EventRow[];

  return rows.map(row => toResponse(row, today));
}

/**
 * Get a single event by ID.
 */
export function getEventById(id: number, db?: Database.Database): EventResponse | null {
  const database = db || getDatabase();

  const row = database.prepare(
    'SELECT * FROM event_calendar WHERE id = ?'
  ).get(id) as EventRow | undefined;

  if (!row) return null;
  return toResponse(row);
}

/**
 * Create a new event.
 */
export function createEvent(data: CreateEventData, db?: Database.Database): EventResponse {
  const database = db || getDatabase();
  const now = new Date().toISOString();

  const result = database.prepare(
    `INSERT INTO event_calendar (name, event_date, event_end_date, category, related_sectors, before_days, after_days, tip, is_seed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    data.name,
    data.eventDate,
    data.eventEndDate || null,
    data.category,
    JSON.stringify(data.relatedSectors),
    data.beforeDays,
    data.afterDays,
    data.tip || null,
    now,
    now
  );

  return getEventById(Number(result.lastInsertRowid), database)!;
}

/**
 * Update an existing event.
 */
export function updateEvent(id: number, data: UpdateEventData, db?: Database.Database): EventResponse | null {
  const database = db || getDatabase();

  const existing = database.prepare('SELECT * FROM event_calendar WHERE id = ?').get(id) as EventRow | undefined;
  if (!existing) return null;

  const now = new Date().toISOString();
  const name = data.name ?? existing.name;
  const eventDate = data.eventDate ?? existing.event_date;
  const eventEndDate = data.eventEndDate !== undefined ? data.eventEndDate : existing.event_end_date;
  const category = data.category ?? existing.category;
  const relatedSectors = data.relatedSectors !== undefined
    ? JSON.stringify(data.relatedSectors)
    : existing.related_sectors;
  const beforeDays = data.beforeDays ?? existing.before_days;
  const afterDays = data.afterDays ?? existing.after_days;
  const tip = data.tip !== undefined ? data.tip : existing.tip;

  database.prepare(
    `UPDATE event_calendar
     SET name = ?, event_date = ?, event_end_date = ?, category = ?,
         related_sectors = ?, before_days = ?, after_days = ?, tip = ?, updated_at = ?
     WHERE id = ?`
  ).run(name, eventDate, eventEndDate, category, relatedSectors, beforeDays, afterDays, tip, now, id);

  return getEventById(id, database);
}

/**
 * Delete an event.
 */
export function deleteEvent(id: number, db?: Database.Database): boolean {
  const database = db || getDatabase();
  const result = database.prepare('DELETE FROM event_calendar WHERE id = ?').run(id);
  return result.changes > 0;
}


// --- Window Change Detection & Message Creation ---

/**
 * Check for window status changes and create event_window messages.
 * Called by the scheduler. Creates messages when entering before_build or after_take_profit.
 */
export function checkWindowChanges(db?: Database.Database): void {
  const database = db || getDatabase();
  const today = todayUTC();

  // Get all events that are currently in before_build or after_take_profit window
  const allEvents = database.prepare('SELECT * FROM event_calendar').all() as EventRow[];

  for (const event of allEvents) {
    const status = calculateWindowStatus(
      event.event_date,
      event.event_end_date,
      event.before_days,
      event.after_days,
      today
    );

    if (status !== 'before_build' && status !== 'after_take_profit') {
      continue;
    }

    const label = WINDOW_LABELS[status];
    const summary = `${event.name} — ${label}`;

    // Check if we already sent this exact message today (idempotent)
    const todayStr = toDateStr(today);
    const existing = database.prepare(
      `SELECT id FROM messages
       WHERE type = 'event_window' AND stock_name = ? AND summary = ?
         AND date(created_at) = ?`
    ).get(event.name, summary, todayStr);

    if (existing) continue;

    // Get target users (active in last 24h, fallback to all)
    const users = database.prepare(
      `SELECT id FROM users WHERE last_login_at > datetime('now', '-24 hours')`
    ).all() as { id: number }[];

    const targetUsers = users.length > 0
      ? users
      : database.prepare('SELECT id FROM users').all() as { id: number }[];

    if (targetUsers.length === 0) continue;

    const detail = JSON.stringify({
      eventId: event.id,
      eventName: event.name,
      eventDate: event.event_date,
      eventEndDate: event.event_end_date,
      category: event.category,
      relatedSectors: event.related_sectors ? JSON.parse(event.related_sectors) : [],
      windowStatus: status,
      windowLabel: label,
      tip: event.tip,
    });

    const now = new Date().toISOString();
    const stmt = database.prepare(
      `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read, created_at)
       VALUES (?, 'event_window', '', ?, ?, ?, 0, ?)`
    );

    const insertAll = database.transaction(() => {
      for (const user of targetUsers) {
        stmt.run(user.id, event.name, summary, detail, now);
      }
    });

    insertAll();
  }
}
