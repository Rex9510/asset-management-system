/**
 * 刷新今日推荐、持仓、关注数据
 *
 * 功能：
 * 1. 增量更新所有持仓/关注/HS300股票的最新K线数据
 * 2. 重新生成今日推荐（每日关注）
 * 3. 更新技术指标缓存
 * 4. 更新商品传导链、周期监控、估值、轮动等分析数据
 *
 * 使用：npx ts-node src/scripts/refreshAllData.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { getDatabase, closeDatabase } from '../db/connection';
import { initializeDatabase } from '../db/init';
import { dailyHistoryUpdate, ensureSpecialStocksHistory } from '../market/historyService';
import { runDailyPickJob } from '../dailypick/dailyPickService';
import { trackDailyPicks } from '../dailypick/dailyPickTrackingService';
import { batchUpdateValuations } from '../valuation/valuationService';
import { updateRotationStatus } from '../rotation/rotationService';
import { updateChainStatus } from '../chain/commodityChainService';
import { updateMarketEnv } from '../marketenv/marketEnvService';
import { updateSentiment } from '../sentiment/sentimentService';
import { updateAllMonitors } from '../cycle/cycleDetectorService';

console.log('='.repeat(60));
console.log('开始刷新数据：今日推荐 + 持仓关注 + 技术指标');
console.log('='.repeat(60));

async function refreshAll() {
  initializeDatabase();
  const db = getDatabase();

  // 1. 增量更新最新K线数据
  console.log('\n[1/6] 增量更新最新K线数据...');
  await dailyHistoryUpdate(db);
  console.log('✓ K线增量更新完成');

  // 2. 确保特殊标的（ETF、周期监控）数据完整
  console.log('\n[2/6] 检查特殊标的（ETF、周期监控）历史数据...');
  await ensureSpecialStocksHistory(db);
  console.log('✓ 特殊标的数据检查完成');

  // 3. 更新商品传导链状态
  console.log('\n[3/6] 更新商品传导链状态...');
  await updateChainStatus(db);
  console.log('✓ 商品传导链更新完成');

  // 4. 更新周期监控
  console.log('\n[4/6] 更新周期监控状态...');
  updateAllMonitors(db);
  console.log('✓ 周期监控更新完成');

  // 5. 更新估值、市场环境、情绪、板块轮动
  console.log('\n[5/6] 更新估值、轮动、市场环境、情绪...');
  batchUpdateValuations(db);
  updateRotationStatus(db);
  updateMarketEnv(db);
  updateSentiment(db);
  console.log('✓ 估值/轮动/市场环境/情绪更新完成');

  // 6. 重新生成今日推荐
  console.log('\n[6/6] 重新生成今日推荐...');
  await runDailyPickJob(db);
  await trackDailyPicks(db);
  console.log('✓ 今日推荐生成完成');

  console.log('\n' + '='.repeat(60));
  console.log('✅ 所有数据刷新完成！');
  console.log('='.repeat(60));

  closeDatabase();
}

refreshAll().catch(err => {
  console.error('❌ 刷新失败:', err);
  closeDatabase();
  process.exit(1);
});
