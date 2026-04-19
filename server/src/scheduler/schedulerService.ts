import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { triggerAnalysis } from '../analysis/analysisService';
import { getQuote } from '../market/marketDataService';
import { dailyHistoryUpdate } from '../market/historyService';
import { runSelfCorrectionCheck } from '../analysis/selfCorrectionService';
import { runTargetPriceCheck } from '../alerts/targetPriceService';
import { generateAmbushRecommendation } from '../alerts/ambushService';
import { isTradingDay, isTradingHours } from './tradingDayGuard';
import { hasSignificantChange, updateSnapshot, initSnapshotCache } from './changeDetector';
import { getDeduplicatedStocks, distributeAnalysisToHolders } from './stockDeduplicator';
import { getUserSettings } from '../settings/userSettingsService';
import { getIndicators } from '../indicators/indicatorService';
import { batchUpdateValuations } from '../valuation/valuationService';
import { updateRotationStatus } from '../rotation/rotationService';
import { updateChainStatus } from '../chain/commodityChainService';
import { updateMarketEnv } from '../marketenv/marketEnvService';
import { updateSentiment } from '../sentiment/sentimentService';
import { updateAllMonitors, refreshAllMonitorPrices } from '../cycle/cycleDetectorService';
import { trackDailyPicks } from '../dailypick/dailyPickTrackingService';
import { checkAllUsersConcentrationRisk } from '../concentration/concentrationService';
import { takeAllUsersSnapshot } from '../snapshot/snapshotService';
import { generateReviews } from '../oplog/operationLogService';

// --- Types ---

export interface VolatilityReport {
  stockCode: string;
  stockName: string;
  changePercent: number;
  reason: string;
  dataSupport: string[];
}

// --- SSE client registry for push notifications ---

type SSEClient = {
  userId: number;
  res: { write: (data: string) => void };
};

const sseClients: SSEClient[] = [];

export function registerSSEClient(userId: number, res: { write: (data: string) => void }): void {
  sseClients.push({ userId, res });
}

export function unregisterSSEClient(res: { write: (data: string) => void }): void {
  const idx = sseClients.findIndex((c) => c.res === res);
  if (idx !== -1) sseClients.splice(idx, 1);
}

function pushToUser(userId: number, event: string, data: unknown): void {
  for (const client of sseClients) {
    if (client.userId === userId) {
      try {
        client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        // Client may have disconnected
      }
    }
  }
}

// --- Scheduler state ---

let fullAnalysisInterval: ReturnType<typeof setInterval> | null = null;
let dailyHistoryTimer: ReturnType<typeof setTimeout> | null = null;
const FULL_ANALYSIS_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Track pending volatility timers so we can cancel them on stop
const pendingVolatilityTimers: ReturnType<typeof setTimeout>[] = [];

// Track post-close task timers
const postCloseTimers: ReturnType<typeof setTimeout>[] = [];

// 10-minute timeout for each post-close task
const TASK_TIMEOUT_MS = 10 * 60 * 1000;

async function refreshAllPositionPrices(db: Database.Database): Promise<void> {
  const stocks = db.prepare(
    'SELECT DISTINCT stock_code, stock_name FROM positions'
  ).all() as { stock_code: string; stock_name: string }[];

  for (const stock of stocks) {
    if (!/^\d{6}$/.test(stock.stock_code)) continue;

    try {
      const quote = await getQuote(stock.stock_code, db);
      db.prepare(
        `INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        quote.stockCode,
        quote.stockName || stock.stock_name || quote.stockCode,
        quote.price,
        quote.changePercent,
        quote.volume,
        quote.timestamp
      );
      continue;
    } catch {
      // Live quote unavailable, fallback to last trading-day close.
    }

    const rows = db.prepare(
      `SELECT trade_date, close_price
       FROM market_history
       WHERE stock_code = ?
       ORDER BY trade_date DESC
       LIMIT 2`
    ).all(stock.stock_code) as { trade_date: string; close_price: number }[];

    if (rows.length === 0) continue;

    const latest = rows[0];
    const prev = rows[1];
    const changePercent =
      prev && prev.close_price > 0
        ? ((latest.close_price - prev.close_price) / prev.close_price) * 100
        : 0;

    // updated_at：用日 K 收盘日合成的占位时间戳，与实时行情 ISO 时间格式不同；仅供展示/缓存，排序以 trade_date 为准。
    db.prepare(
      `INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at)
       VALUES (?, ?, ?, ?, COALESCE((SELECT volume FROM market_cache WHERE stock_code = ?), 0), ?)`
    ).run(
      stock.stock_code,
      stock.stock_name || stock.stock_code,
      latest.close_price,
      changePercent,
      stock.stock_code,
      `${latest.trade_date}T15:00:00.000+08:00`
    );
  }
}

// --- Start / Stop ---

export function startScheduler(): void {
  if (fullAnalysisInterval) return; // Already running

  // Initialize change detection snapshot cache
  initSnapshotCache();

  fullAnalysisInterval = setInterval(() => {
    runScheduledJobs().catch(() => {
      // Scheduler errors are non-critical, log silently
    });
  }, FULL_ANALYSIS_INTERVAL_MS);

  // Schedule all post-close tasks (15:30-17:30 staggered)
  schedulePostCloseTasks();
}

export function stopScheduler(): void {
  if (fullAnalysisInterval) {
    clearInterval(fullAnalysisInterval);
    fullAnalysisInterval = null;
  }
  if (dailyHistoryTimer) {
    clearTimeout(dailyHistoryTimer);
    dailyHistoryTimer = null;
  }
  for (const timer of pendingVolatilityTimers) {
    clearTimeout(timer);
  }
  pendingVolatilityTimers.length = 0;
  for (const timer of postCloseTimers) {
    clearTimeout(timer);
  }
  postCloseTimers.length = 0;
}

/**
 * Helper: wrap a promise with a timeout. Rejects if the task exceeds the limit.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, taskName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${taskName} 超时(${ms / 1000}s)`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Post-close task definitions.
 * Each task has a scheduled time (hour:minute), a name, and an executor function.
 */
export interface PostCloseTask {
  hour: number;
  minute: number;
  name: string;
  execute: (db: Database.Database) => Promise<void>;
}

/**
 * Build the list of post-close tasks with staggered schedule (15:30-17:30).
 * Exported for testing.
 */
export function getPostCloseTaskList(): PostCloseTask[] {
  return [
    {
      hour: 15, minute: 30, name: 'K线增量更新',
      execute: async () => { await dailyHistoryUpdate(); },
    },
    {
      hour: 15, minute: 45, name: '估值分位数据更新',
      execute: async (db) => { await batchUpdateValuations(db, 500); },
    },
    {
      hour: 16, minute: 0, name: '板块轮动阶段判断',
      execute: async (db) => { await updateRotationStatus(db); },
    },
    {
      hour: 16, minute: 10, name: '商品传导链状态更新',
      execute: async (db) => { await updateChainStatus(db); },
    },
    {
      hour: 16, minute: 20, name: '大盘环境判断',
      execute: async (db) => { await updateMarketEnv(db); },
    },
    {
      hour: 16, minute: 30, name: '市场情绪指数计算',
      execute: async (db) => { updateSentiment(db); },
    },
    {
      hour: 16, minute: 40, name: '周期底部检测',
      execute: async (db) => {
        await refreshAllMonitorPrices(db);
        updateAllMonitors(db);
      },
    },
    {
      hour: 16, minute: 50, name: '每日关注追踪',
      execute: async (db) => { await trackDailyPicks(db); },
    },
    {
      hour: 17, minute: 0, name: '持仓集中度检查',
      execute: async (db) => {
        await refreshAllPositionPrices(db);
        checkAllUsersConcentrationRisk(db);
      },
    },
    {
      hour: 17, minute: 10, name: '持仓快照记录',
      execute: async (db) => {
        const today = new Date().toISOString().slice(0, 10);
        takeAllUsersSnapshot(today, db);
      },
    },
    {
      hour: 17, minute: 20, name: '操作复盘评价生成',
      execute: async (db) => { generateReviews(db); },
    },
  ];
}

/**
 * Execute a single post-close task with trading day guard, try-catch, and 10-min timeout.
 * Exported for testing.
 */
export async function executePostCloseTask(
  task: PostCloseTask,
  db?: Database.Database
): Promise<void> {
  const database = db || getDatabase();
  const now = new Date();

  // Trading day guard
  if (!isTradingDay(now)) {
    console.log(`非交易日，跳过: ${task.name}`);
    return;
  }

  try {
    await withTimeout(task.execute(database), TASK_TIMEOUT_MS, task.name);
    console.log(`✅ ${task.name} 完成`);
  } catch (err) {
    console.error(`❌ ${task.name} 失败:`, err);
    // Single task failure doesn't stop the batch — independent try-catch
  }
}

/**
 * 非交易日启动时，也跑一次纯规则的数据计算任务（用最近交易日的K线数据）。
 * 这样前端在周末/节假日也能展示最近交易日的大盘环境、轮动、情绪等数据，
 * 而不是显示空白。跳过K线更新（非交易日无新数据）。
 */
export async function runStartupDataRefresh(db?: Database.Database): Promise<void> {
  const database = db || getDatabase();

  // 纯规则任务列表（跳过K线更新、每日关注追踪、操作复盘等依赖当日交易的任务）
  const ruleBasedTasks: { name: string; execute: (d: Database.Database) => void | Promise<void> }[] = [
    { name: '估值分位数据更新', execute: async (d) => { await batchUpdateValuations(d, 500); } },
    { name: '板块轮动阶段判断', execute: async (d) => { await updateRotationStatus(d); } },
    { name: '商品传导链状态更新', execute: async (d) => { await updateChainStatus(d); } },
    { name: '大盘环境判断', execute: async (d) => { await updateMarketEnv(d); } },
    { name: '市场情绪指数计算', execute: (d) => { updateSentiment(d); } },
    { name: '持仓价格刷新', execute: async (d) => { await refreshAllPositionPrices(d); } },
    { name: '周期监控价格刷新', execute: async (d) => { await refreshAllMonitorPrices(d); } },
    { name: '周期底部检测', execute: (d) => { updateAllMonitors(d); } },
    { name: '持仓集中度检查', execute: (d) => { checkAllUsersConcentrationRisk(d); } },
  ];

  console.log('非交易日启动，使用最近交易日数据刷新展示...');
  for (const task of ruleBasedTasks) {
    try {
      await task.execute(database);
      console.log(`  ✅ ${task.name}`);
    } catch (err) {
      console.error(`  ❌ ${task.name}:`, err);
    }
  }
  console.log('非交易日数据刷新完成');
}

/**
 * Schedule all post-close tasks at their staggered times (15:30-17:30).
 * Each task is scheduled via setTimeout from the current time.
 * After all tasks fire, re-schedules for the next day.
 */
function schedulePostCloseTasks(): void {
  const tasks = getPostCloseTaskList();
  const now = new Date();

  // Find the latest task time to know when to re-schedule
  let latestMs = 0;

  for (const task of tasks) {
    const target = new Date(now);
    target.setHours(task.hour, task.minute, 0, 0);

    // If this time already passed today, schedule for tomorrow
    if (now >= target) {
      target.setDate(target.getDate() + 1);
    }

    const msUntilTarget = target.getTime() - now.getTime();
    if (msUntilTarget > latestMs) latestMs = msUntilTarget;

    const timer = setTimeout(() => {
      executePostCloseTask(task).catch((err) => {
        console.error(`[schedulePostCloseTasks] ${task.name} 异常:`, err);
      });
    }, msUntilTarget);

    postCloseTimers.push(timer);
  }

  // Re-schedule after the latest task + a buffer (30 min after last task)
  const rescheduleMs = latestMs + 30 * 60 * 1000;
  const rescheduleTimer = setTimeout(() => {
    // Clear old timers
    postCloseTimers.length = 0;
    // Re-schedule for next day
    schedulePostCloseTasks();
  }, rescheduleMs);
  postCloseTimers.push(rescheduleTimer);

  const firstTask = tasks[0];
  const firstTarget = new Date(now);
  firstTarget.setHours(firstTask.hour, firstTask.minute, 0, 0);
  if (now >= firstTarget) firstTarget.setDate(firstTarget.getDate() + 1);
  console.log(`收盘后定时任务已调度(${tasks.length}个)，首个任务将在 ${firstTarget.toLocaleString()} 执行`);
}

// --- Run all scheduled jobs ---

export async function runScheduledJobs(db?: Database.Database): Promise<void> {
  const database = db || getDatabase();
  const now = new Date();

  // Trading day + trading hours guard for intraday analysis
  if (!isTradingDay(now)) {
    console.log('非交易日，跳过盘中定时分析');
    return;
  }
  if (!isTradingHours(now)) {
    console.log('非交易时间，跳过盘中定时分析');
    return;
  }

  // 1. Full analysis with dedup + change detection (定时分析)
  try {
    const count = await runFullAnalysis(database);
    console.log(`定时分析完成: ${count} 条`);
  } catch (err) {
    console.error('定时分析失败:', err);
  }

  // 1.5 周期监控价格刷新（优先实时行情，失败回退最近交易日）
  try {
    await refreshAllMonitorPrices(database);
  } catch (err) {
    console.error('周期监控价格刷新失败:', err);
  }

  // 1.6 持仓/关注价格刷新（优先实时行情，失败回退最近交易日）
  try {
    await refreshAllPositionPrices(database);
  } catch (err) {
    console.error('持仓价格刷新失败:', err);
  }

  // 2. Volatility check (波动提醒) - check all user positions
  try {
    const positions = database
      .prepare('SELECT DISTINCT stock_code FROM positions')
      .all() as { stock_code: string }[];
    for (const pos of positions) {
      try {
        const quote = await getQuote(pos.stock_code, database);
        await checkVolatility(pos.stock_code, quote.changePercent, database);
      } catch {
        // Individual stock check failure is non-critical
      }
    }
  } catch (err) {
    console.error('波动检查失败:', err);
  }

  // 3. Self-correction check (自我修正 — 仅记录偏差事实，不调用AI)
  try {
    const corrections = await runSelfCorrectionCheck(database);
    if (corrections > 0) console.log(`自我修正: ${corrections} 条`);
  } catch (err) {
    console.error('自我修正检查失败:', err);
  }

  // 4. Target price check (目标价提醒)
  try {
    const alerts = await runTargetPriceCheck(database);
    if (alerts.length > 0) console.log(`目标价提醒: ${alerts.length} 条`);
  } catch (err) {
    console.error('目标价检查失败:', err);
  }

  // 5. Ambush recommendation (埋伏推荐) - for each active user
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const users = database
      .prepare(`
        SELECT DISTINCT p.user_id FROM positions p
        INNER JOIN users u ON p.user_id = u.id
        WHERE u.last_login_at >= ? OR u.last_login_at IS NULL
      `)
      .all(cutoff) as { user_id: number }[];
    for (const u of users) {
      try {
        await generateAmbushRecommendation(u.user_id, database);
      } catch {
        // Individual user ambush failure is non-critical
      }
    }
  } catch (err) {
    console.error('埋伏推荐失败:', err);
  }
}

// --- User analysis frequency helpers ---

/**
 * Get the list of holder user IDs that are due for analysis based on their
 * configured analysis_frequency setting. A user is due when the time since
 * their last scheduled_analysis message for this stock exceeds their frequency.
 *
 * Default frequency is 60 minutes. Valid values: 30, 60, 120 (minutes).
 */
export function getHoldersDueForAnalysis(
  stockCode: string,
  holderUserIds: number[],
  db: Database.Database
): number[] {
  const now = Date.now();
  const due: number[] = [];

  for (const userId of holderUserIds) {
    let frequencyMs = 60 * 60 * 1000; // default 60 min
    try {
      const settings = getUserSettings(userId, db);
      const freq = settings.analysisFrequency;
      if (freq === 30 || freq === 60 || freq === 120) {
        frequencyMs = freq * 60 * 1000;
      }
    } catch {
      // Use default frequency on error
    }

    // Check last scheduled_analysis message time for this user+stock
    try {
      const lastMsg = db.prepare(
        `SELECT created_at FROM messages
         WHERE user_id = ? AND stock_code = ? AND type = 'scheduled_analysis'
         ORDER BY created_at DESC LIMIT 1`
      ).get(userId, stockCode) as { created_at: string } | undefined;

      if (lastMsg) {
        const lastTime = new Date(lastMsg.created_at).getTime();
        if (now - lastTime < frequencyMs) {
          // Within user's configured frequency window — skip
          continue;
        }
      }
    } catch {
      // If query fails, include user (safe default)
    }

    due.push(userId);
  }

  return due;
}

// --- Full analysis (every 30 minutes) ---

export async function runFullAnalysis(db?: Database.Database): Promise<number> {
  const database = db || getDatabase();

  // Get deduplicated stock list (active users only, same stock analyzed once)
  const deduplicatedStocks = getDeduplicatedStocks(database);

  let analysisCount = 0;

  for (const stock of deduplicatedStocks) {
    try {
      // Filter holders by their configured analysis frequency
      const dueHolders = getHoldersDueForAnalysis(stock.stockCode, stock.holderUserIds, database);
      if (dueHolders.length === 0) {
        // No holders need analysis at this time — skip stock entirely
        continue;
      }

      // Get current price for change detection
      const quote = await getQuote(stock.stockCode, database);

      // Get RSI for change detection
      let currentRsi: number | null = null;
      try {
        const indicators = getIndicators(stock.stockCode, database);
        currentRsi = indicators.rsi.rsi6;
      } catch {
        // RSI not available
      }

      // Change detection: skip AI if price change < 2% and RSI change < 5
      if (!hasSignificantChange(stock.stockCode, quote.price, currentRsi)) {
        // Reuse last analysis — no AI call needed
        continue;
      }

      // Use first due holder's userId for analysis (result shared to all due holders)
      const primaryUserId = dueHolders[0];
      const analysis = await triggerAnalysis(stock.stockCode, primaryUserId, 'scheduled', database);

      // Update change detection snapshot
      updateSnapshot(stock.stockCode, quote.price, currentRsi);

      // Distribute analysis message only to holders who are due
      const summary = `定时分析：${stock.stockName}(${stock.stockCode}) - ${analysis.actionRef}`;
      const detail = JSON.stringify({
        stage: analysis.stage,
        confidence: analysis.confidence,
        actionRef: analysis.actionRef,
        reasoning: analysis.reasoning,
      });

      distributeAnalysisToHolders(
        stock.stockCode,
        stock.stockName,
        dueHolders,
        analysis.id,
        summary,
        detail,
        'scheduled_analysis',
        database
      );

      // Push notification via SSE only to due holders
      for (const userId of dueHolders) {
        pushToUser(userId, 'analysis', {
          type: 'scheduled_analysis',
          stockCode: stock.stockCode,
          stockName: stock.stockName,
          analysisId: analysis.id,
        });
      }

      analysisCount++;
    } catch (err) {
      console.error(`[runFullAnalysis] Stock ${stock.stockCode} failed:`, err);
      // Individual analysis failure should not stop the batch
    }
  }

  return analysisCount;
}

// --- Volatility check ---

export async function checkVolatility(
  stockCode: string,
  changePercent: number,
  db?: Database.Database
): Promise<void> {
  // 双重保险：非交易日/非交易时间不发送波动提醒
  // 即使上层漏了，这里也挡住
  const now = new Date();
  if (!isTradingDay(now) || !isTradingHours(now)) {
    return;
  }

  const absChange = Math.abs(changePercent);

  if (absChange > 5) {
    // >5% volatility: generate volatility report and trigger analysis
    await handleHighVolatility(stockCode, changePercent, db);
  } else if (absChange > 3) {
    // >3% change: trigger urgent analysis within 60 seconds
    await handleUrgentAnalysis(stockCode, changePercent, db);
  }
}

// --- >3% urgent analysis ---

async function handleUrgentAnalysis(
  stockCode: string,
  changePercent: number,
  db?: Database.Database
): Promise<void> {
  const database = db || getDatabase();

  // Find all users holding this stock
  const holders = database
    .prepare('SELECT DISTINCT user_id, stock_name FROM positions WHERE stock_code = ?')
    .all(stockCode) as { user_id: number; stock_name: string }[];

  for (const holder of holders) {
    try {
      const analysis = await triggerAnalysis(stockCode, holder.user_id, 'volatility', database);

      // Store as volatility_alert message
      database.prepare(
        `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, analysis_id, created_at)
         VALUES (?, 'volatility_alert', ?, ?, ?, ?, ?, ?)`
      ).run(
        holder.user_id,
        stockCode,
        holder.stock_name,
        `波动提醒：${holder.stock_name}(${stockCode}) 涨跌幅 ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
        JSON.stringify({
          changePercent,
          stage: analysis.stage,
          confidence: analysis.confidence,
          actionRef: analysis.actionRef,
          reasoning: analysis.reasoning,
        }),
        analysis.id,
        new Date().toISOString()
      );

      pushToUser(holder.user_id, 'volatility_alert', {
        type: 'volatility_alert',
        stockCode,
        stockName: holder.stock_name,
        changePercent,
        analysisId: analysis.id,
      });
    } catch {
      // Individual failure should not stop processing other holders
    }
  }
}

// --- >5% high volatility report ---

async function handleHighVolatility(
  stockCode: string,
  changePercent: number,
  db?: Database.Database
): Promise<void> {
  const database = db || getDatabase();

  // Build volatility report with ≥2 data support items
  const report = await buildVolatilityReport(stockCode, changePercent, database);

  // Find all users holding this stock
  const holders = database
    .prepare('SELECT DISTINCT user_id, stock_name FROM positions WHERE stock_code = ?')
    .all(stockCode) as { user_id: number; stock_name: string }[];

  for (const holder of holders) {
    try {
      const analysis = await triggerAnalysis(stockCode, holder.user_id, 'volatility', database);

      // Store volatility report as message
      database.prepare(
        `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, analysis_id, created_at)
         VALUES (?, 'volatility_alert', ?, ?, ?, ?, ?, ?)`
      ).run(
        holder.user_id,
        stockCode,
        holder.stock_name,
        `剧烈波动：${holder.stock_name}(${stockCode}) 涨跌幅 ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
        JSON.stringify({
          changePercent,
          volatilityReport: report,
          stage: analysis.stage,
          confidence: analysis.confidence,
          actionRef: analysis.actionRef,
          reasoning: analysis.reasoning,
        }),
        analysis.id,
        new Date().toISOString()
      );

      pushToUser(holder.user_id, 'volatility_alert', {
        type: 'volatility_alert',
        stockCode,
        stockName: holder.stock_name,
        changePercent,
        volatilityReport: report,
        analysisId: analysis.id,
      });
    } catch {
      // Individual failure should not stop processing other holders
    }
  }
}

// --- Build volatility report with ≥2 data support items ---

export async function buildVolatilityReport(
  stockCode: string,
  changePercent: number,
  db?: Database.Database
): Promise<VolatilityReport> {
  const database = db || getDatabase();

  const dataSupport: string[] = [];

  // 1. Get current quote for volume data
  try {
    const quote = await getQuote(stockCode, database);
    dataSupport.push(`当前成交量: ${quote.volume}，价格: ${quote.price}`);
  } catch {
    // Quote not available
  }

  // 2. Check market history for recent trend
  try {
    const history = database
      .prepare(
        'SELECT close_price, volume FROM market_history WHERE stock_code = ? ORDER BY trade_date DESC LIMIT 5'
      )
      .all(stockCode) as { close_price: number; volume: number }[];

    if (history.length >= 2) {
      const avgVolume = history.reduce((sum, h) => sum + h.volume, 0) / history.length;
      dataSupport.push(`近${history.length}日平均成交量: ${avgVolume.toFixed(0)}`);
    }
  } catch {
    // History not available
  }

  // 3. Check news for related events
  try {
    const news = database
      .prepare(
        'SELECT title FROM news_cache WHERE stock_code = ? ORDER BY published_at DESC LIMIT 3'
      )
      .all(stockCode) as { title: string }[];

    if (news.length > 0) {
      dataSupport.push(`相关新闻: ${news.map((n) => n.title).join('；')}`);
    }
  } catch {
    // News not available
  }

  // Ensure at least 2 data support items
  if (dataSupport.length < 2) {
    dataSupport.push(`涨跌幅: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%`);
  }
  if (dataSupport.length < 2) {
    dataSupport.push(`触发时间: ${new Date().toISOString()}`);
  }

  // Get stock name from cache or positions
  let stockName = stockCode;
  try {
    const cached = database
      .prepare('SELECT stock_name FROM market_cache WHERE stock_code = ?')
      .get(stockCode) as { stock_name: string } | undefined;
    if (cached) stockName = cached.stock_name;
  } catch {
    // Use code as fallback
  }

  const direction = changePercent > 0 ? '大幅上涨' : '大幅下跌';
  const reason = `${stockName}(${stockCode})${direction}${Math.abs(changePercent).toFixed(2)}%，触发波动分析`;

  return {
    stockCode,
    stockName,
    changePercent,
    reason,
    dataSupport,
  };
}
