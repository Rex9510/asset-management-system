/**
 * 按建仓日(buy_date)修正快照数据并补录缺口、刷新当日快照。
 *
 * 步骤：
 * 0. 从行情拉取上证日 K，同步 trading_calendar_sdk（与运行时 isTradingDay 一致）
 * 1. 删除 snapshot_date < buy_date 的快照行（旧逻辑或填错建仓日前的脏数据）
 * 2. 删除「快照日期本身非交易日」的行（例如曾在周末执行过 takeSnapshot）
 * 3. backfillMissingSnapshots：对缺失交易日按当前持仓+buy_date 补历史收盘价
 * 4. 若今天为交易日：takeAllUsersSnapshot(今天)；否则跳过（休市日不落库）
 *
 * 使用（在 server 目录）：
 *   npm run snapshots:refresh
 * 可选：DB_PATH=... 指向你的 app.db
 */
import dotenv from 'dotenv';
dotenv.config();

import { getDatabase, closeDatabase } from '../db/connection';
import { initializeDatabase } from '../db/init';
import { isTradingDayIsoDate } from '../scheduler/tradingDayGuard';
import {
  backfillMissingSnapshots,
  deleteSnapshotsViolatingBuyDate,
  deleteSnapshotsOnNonTradingDays,
  takeAllUsersSnapshot,
} from '../snapshot/snapshotService';
import { syncTradingCalendarFromMarket } from '../scheduler/tradingCalendarSyncService';

async function main(): Promise<void> {
  initializeDatabase();
  const db = getDatabase();

  try {
    await syncTradingCalendarFromMarket(db);
  } catch (err) {
    console.error('[交易日历] 同步失败，将继续使用已有缓存/holidays.json：', err);
  }

  const removedBuy = deleteSnapshotsViolatingBuyDate(db);
  console.log(`已删除违反建仓日的快照行：${removedBuy} 条`);

  const removedNonTd = deleteSnapshotsOnNonTradingDays(db);
  console.log(`已删除非交易日快照行：${removedNonTd} 条`);

  backfillMissingSnapshots(db);
  console.log('缺失交易日快照补录已执行（见上方日志）。');

  const today = new Date().toISOString().slice(0, 10);
  if (isTradingDayIsoDate(today)) {
    takeAllUsersSnapshot(today, db);
    console.log(`已刷新当日快照：${today}`);
  } else {
    console.log(`今日 ${today} 非 A 股交易日，跳过当日快照（休市日不应落库）。`);
  }

  closeDatabase();
}

main().catch((err) => {
  console.error('执行失败:', err);
  closeDatabase();
  process.exit(1);
});
