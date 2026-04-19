/**
 * 从行情侧同步 A 股交易日：拉取上证指数(000001)日 K 的 trade_date，
 * 有 K 线的日历日视为已开市交易日，写入 trading_calendar_sdk 供 tradingDayGuard 叠加判断。
 */
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { fetchKlineMultiSegment } from '../market/historyService';
import { reloadTradingCalendarSdkFromDb } from './tradingDayGuard';

const INDEX_CODE = '000001';
const SOURCE_TAG = 'tencent_kline_sh000001';
const KLINE_YEARS_BACK = 4;

/**
 * 拉取近年上证日 K，全量重写 trading_calendar_sdk，并刷新内存缓存。
 */
export async function syncTradingCalendarFromMarket(db?: Database.Database): Promise<{
  tradeDayCount: number;
}> {
  const database = db ?? getDatabase();
  const rows = await fetchKlineMultiSegment(INDEX_CODE, KLINE_YEARS_BACK);
  const dates = [...new Set(rows.map((r) => r.tradeDate))].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  dates.sort();

  const syncedAt = new Date().toISOString();
  const insert = database.prepare(
    `INSERT OR REPLACE INTO trading_calendar_sdk (trade_date, source, synced_at) VALUES (?, ?, ?)`
  );

  const run = database.transaction((list: string[]) => {
    database.prepare('DELETE FROM trading_calendar_sdk').run();
    for (const d of list) {
      insert.run(d, SOURCE_TAG, syncedAt);
    }
    return list.length;
  });

  const tradeDayCount = run(dates);
  reloadTradingCalendarSdkFromDb(database);
  console.log(`[交易日历] 已从行情同步 ${tradeDayCount} 个交易日 (${INDEX_CODE} 日K)`);
  return { tradeDayCount };
}
