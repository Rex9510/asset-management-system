import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { initializeDatabase } from './db/init';
import { seedEvents } from './events/seedEvents';
import { startScheduler, runScheduledJobs, runStartupDataRefresh } from './scheduler/schedulerService';
import { runDailyPickJob } from './dailypick/dailyPickService';
import { ensureAllUserStocksHistory, ensureSpecialStocksHistory } from './market/historyService';
import { isTradingDay } from './scheduler/tradingDayGuard';
import { fixBrokenMonitorCodes, updateAllMonitorsWithAI } from './cycle/cycleDetectorService';
import { backfillMissingSnapshots, deleteSnapshotsOnNonTradingDays } from './snapshot/snapshotService';
import { syncTradingCalendarFromMarket } from './scheduler/tradingCalendarSyncService';
import { refreshIndexQuotes } from './sentiment/sentimentService';

const PORT = process.env.PORT || 3000;

initializeDatabase();
seedEvents();

// 修复 cycle_monitors 中 stock_code 存了名称的脏数据
fixBrokenMonitorCodes();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Start the scheduler for periodic analysis
  startScheduler();
  console.log('Scheduler started');

  // 先刷新指数行情（上证/沪深300），然后跑纯规则数据刷新
  refreshIndexQuotes().then(() => {
    console.log('Index quotes refreshed');
    // 始终跑纯规则数据刷新（情绪、轮动、传导链、大盘环境等）
    return runStartupDataRefresh();
  }).then(() => {
    console.log('Startup data refresh complete');
  }).catch((err) => {
    console.error('Startup data refresh failed:', err);
  });

  // 交易日+交易时间内，额外跑盘中定时分析（含AI分析、波动检查等）
  const now = new Date();
  if (isTradingDay(now)) {
    runScheduledJobs().then(() => {
      console.log('Startup scheduled jobs complete');
    }).catch((err) => {
      console.error('Startup scheduled jobs failed:', err);
    });
  }

  // Run daily picks on startup (in case none exist yet)
  runDailyPickJob().then(() => {
    console.log('Daily picks generated');
  }).catch((err) => {
    console.error('Daily picks generation failed:', err);
  });

  // Ensure all user position stocks have history data
  ensureAllUserStocksHistory().then(() => {
    console.log('User stocks history check complete');
    // 确保ETF和周期监控标的也有历史数据
    return ensureSpecialStocksHistory();
  }).then(async () => {
    console.log('Special stocks (ETF + cycle monitors) history check complete');
    // 历史数据就绪后，强制刷新所有周期监控（用最新数据重新检测）
    await updateAllMonitorsWithAI();
    console.log('Cycle monitors refreshed with latest history data');
    try {
      await syncTradingCalendarFromMarket();
    } catch (err) {
      console.error('[交易日历] 启动同步失败（将依赖 holidays.json 与本地缓存）:', err);
    }
    // 清理曾误写入「休市日」的快照（节假日表更新或旧环境仅按周末判断时产生）
    const removedNonTrading = deleteSnapshotsOnNonTradingDays();
    if (removedNonTrading > 0) {
      console.log(`已清理非交易日快照：${removedNonTrading} 条`);
    }
    // 自动补录缺失的持仓快照（服务器停机期间的交易日）
    console.log('检查并补录缺失的持仓快照...');
    backfillMissingSnapshots();
  }).catch((err) => {
    console.error('Stocks history check failed:', err);
  });
});
