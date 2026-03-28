/**
 * 批量补全所有股票历史K线数据到40年
 *
 * 覆盖：
 * - 用户持仓股票
 * - 用户关注股票
 * - 今日关注列表股票
 * - 沪深300成分股
 *
 * 使用：npx ts-node src/scripts/backfillAllHistory.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import Database from 'better-sqlite3';
import { getDatabase, closeDatabase } from '../db/connection';
import { fetchAndSaveStockHistory } from '../market/historyService';
import { DailyPickMessage } from '../../../client/src/api/messages';

console.log('='.repeat(60));
console.log('批量补全所有股票历史K线数据 (40年完整历史)');
console.log('='.repeat(60));

async function backfillAll() {
  const db = getDatabase();

  // 1. 获取所有需要补全的股票代码（去重）
  const stockMap = new Map<string, string>();

  // - 用户持仓 + 关注
  const positions = db.prepare(`
    SELECT DISTINCT stock_code, stock_name FROM positions
  `).all() as { stock_code: string; stock_name: string }[];
  console.log(`找到 ${positions.length} 只持仓/关注股票`);
  for (const p of positions) {
    stockMap.set(p.stock_code, p.stock_name);
  }

  // - 今日关注列表
  try {
    const dailyPicks = db.prepare(`
      SELECT DISTINCT stock_code, stock_name FROM daily_picks
    `).all() as { stock_code: string; stock_name: string }[];
    console.log(`找到 ${dailyPicks.length} 只每日关注股票`);
    for (const p of dailyPicks) {
      stockMap.set(p.stock_code, p.stock_name);
    }
  } catch {
    console.log('daily_picks表不存在，跳过');
  }

  // - 沪深300成分股
  try {
    const hs300 = db.prepare(`
      SELECT DISTINCT stock_code, stock_name FROM hs300_constituents
    `).all() as { stock_code: string; stock_name: string }[];
    console.log(`找到 ${hs300.length} 只沪深300成分股`);
    for (const p of hs300) {
      stockMap.set(p.stock_code, p.stock_name);
    }
  } catch {
    console.log('hs300_constituents表不存在，跳过');
  }

  const allStocks = Array.from(stockMap.entries()).map(([code, name]) => ({ code, name }));
  console.log(`\n总计需要补全 ${allStocks.length} 只股票（去重后）`);
  console.log('每只股票拉取40年历史数据，预计需要一段时间，请耐心等待...\n');

  let success = 0;
  let failed = 0;
  let totalKlines = 0;

  for (let i = 0; i < allStocks.length; i++) {
    const stock = allStocks[i];
    try {
      console.log(`[${i + 1}/${allStocks.length}] ${stock.name}(${stock.code}) 开始拉取...`);
      const count = await fetchAndSaveStockHistory(stock.code, 40, db);
      totalKlines += count;
      success++;
      console.log(`  ✓ 完成，获取 ${count} 条K线`);
    } catch (err) {
      failed++;
      console.error(`  ✗ 失败: ${(err as Error).message}`);
    }

    // 每只之间延迟1秒，避免请求过快
    if (i < allStocks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('补全完成!');
  console.log(`  成功: ${success} 只`);
  console.log(`  失败: ${failed} 只`);
  console.log(`  总计K线条数: ${totalKlines}`);
  console.log('='.repeat(60));

  const histCount = db.prepare('SELECT COUNT(*) as cnt FROM market_history').get() as { cnt: number };
  console.log(`\nmarket_history 表总计: ${histCount.cnt} 条记录`);

  closeDatabase();
}

backfillAll().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
