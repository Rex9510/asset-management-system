/**
 * 事件日历种子数据
 *
 * 内置年度常规事件：两会、中报、三季报、年报、美联储议息会议、双十一、中央经济工作会议等。
 * 系统初始化时自动导入，标记 is_seed=1，幂等操作。
 */
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';

const SEED_EVENTS = [
  { name: '全国两会', eventDate: '2026-03-03', eventEndDate: '2026-03-15', category: 'policy', relatedSectors: '["基建","环保","科技"]', beforeDays: 7, afterDays: 5, tip: '关注政策方向' },
  { name: '中报披露期', eventDate: '2026-07-15', eventEndDate: '2026-08-31', category: 'financial_report', relatedSectors: '["全行业"]', beforeDays: 10, afterDays: 5, tip: '关注业绩超预期个股' },
  { name: '三季报披露期', eventDate: '2026-10-15', eventEndDate: '2026-10-31', category: 'financial_report', relatedSectors: '["全行业"]', beforeDays: 7, afterDays: 3, tip: '关注三季度业绩' },
  { name: '年报披露期', eventDate: '2026-03-01', eventEndDate: '2026-04-30', category: 'financial_report', relatedSectors: '["全行业"]', beforeDays: 10, afterDays: 5, tip: '关注年度业绩' },
  { name: '美联储议息会议', eventDate: '2026-01-28', eventEndDate: '2026-01-29', category: 'economic_data', relatedSectors: '["金融","科技"]', beforeDays: 3, afterDays: 2, tip: '关注利率决议' },
  { name: '美联储议息会议', eventDate: '2026-03-18', eventEndDate: '2026-03-19', category: 'economic_data', relatedSectors: '["金融","科技"]', beforeDays: 3, afterDays: 2, tip: '关注利率决议' },
  { name: '3月PMI数据发布', eventDate: '2026-03-31', eventEndDate: '2026-03-31', category: 'economic_data', relatedSectors: '["周期品","制造业"]', beforeDays: 3, afterDays: 1, tip: '数据公布前后波动大，已持仓可持有，未建仓宜等待' },
  { name: '美联储议息会议', eventDate: '2026-05-06', eventEndDate: '2026-05-07', category: 'economic_data', relatedSectors: '["金融","科技"]', beforeDays: 3, afterDays: 2, tip: '关注利率决议' },
  { name: '美联储议息会议', eventDate: '2026-06-17', eventEndDate: '2026-06-18', category: 'economic_data', relatedSectors: '["金融","科技"]', beforeDays: 3, afterDays: 2, tip: '关注利率决议' },
  { name: '美联储议息会议', eventDate: '2026-07-29', eventEndDate: '2026-07-30', category: 'economic_data', relatedSectors: '["金融","科技"]', beforeDays: 3, afterDays: 2, tip: '关注利率决议' },
  { name: '美联储议息会议', eventDate: '2026-09-16', eventEndDate: '2026-09-17', category: 'economic_data', relatedSectors: '["金融","科技"]', beforeDays: 3, afterDays: 2, tip: '关注利率决议' },
  { name: '美联储议息会议', eventDate: '2026-11-04', eventEndDate: '2026-11-05', category: 'economic_data', relatedSectors: '["金融","科技"]', beforeDays: 3, afterDays: 2, tip: '关注利率决议' },
  { name: '美联储议息会议', eventDate: '2026-12-16', eventEndDate: '2026-12-17', category: 'economic_data', relatedSectors: '["金融","科技"]', beforeDays: 3, afterDays: 2, tip: '关注利率决议' },
  { name: '双十一购物节', eventDate: '2026-11-01', eventEndDate: '2026-11-11', category: 'exhibition', relatedSectors: '["消费","电商","物流"]', beforeDays: 10, afterDays: 5, tip: '关注消费板块' },
  { name: '中央经济工作会议', eventDate: '2026-12-10', eventEndDate: '2026-12-12', category: 'policy', relatedSectors: '["全行业"]', beforeDays: 5, afterDays: 3, tip: '关注来年经济政策方向' },
  // 每月PMI数据
  { name: '4月PMI数据发布', eventDate: '2026-04-30', eventEndDate: '2026-04-30', category: 'economic_data', relatedSectors: '["周期品","制造业"]', beforeDays: 2, afterDays: 1, tip: '关注制造业景气度变化' },
  { name: '5月PMI数据发布', eventDate: '2026-05-31', eventEndDate: '2026-05-31', category: 'economic_data', relatedSectors: '["周期品","制造业"]', beforeDays: 2, afterDays: 1, tip: '关注制造业景气度变化' },
];

/**
 * Import seed events into the database.
 * Idempotent: only inserts if no seed events exist.
 */
export function seedEvents(db?: Database.Database): void {
  const database = db || getDatabase();

  // Check if seed events already exist
  const count = database.prepare(
    'SELECT COUNT(*) as cnt FROM event_calendar WHERE is_seed = 1'
  ).get() as { cnt: number };

  if (count.cnt > 0) {
    // 已有种子事件，执行更新（删除旧的重新插入）
    reseedEvents(database);
    return;
  }

  insertSeedEvents(database);
}

/**
 * Delete all existing seed events and re-insert fresh ones.
 * Used when seed data has been updated (e.g., new events added).
 */
export function reseedEvents(db?: Database.Database): void {
  const database = db || getDatabase();
  database.prepare('DELETE FROM event_calendar WHERE is_seed = 1').run();
  insertSeedEvents(database);
}

function insertSeedEvents(database: Database.Database): void {
  const now = new Date().toISOString();
  const stmt = database.prepare(
    `INSERT INTO event_calendar (name, event_date, event_end_date, category, related_sectors, before_days, after_days, tip, is_seed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );

  const insertAll = database.transaction(() => {
    for (const e of SEED_EVENTS) {
      stmt.run(
        e.name,
        e.eventDate,
        e.eventEndDate,
        e.category,
        e.relatedSectors,
        e.beforeDays,
        e.afterDays,
        e.tip,
        now,
        now
      );
    }
  });

  insertAll();
}

export { SEED_EVENTS };
