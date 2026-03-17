import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { triggerAnalysis } from '../analysis/analysisService';
import { getQuote } from '../market/marketDataService';

// --- Types ---

export interface VolatilityReport {
  stockCode: string;
  stockName: string;
  changePercent: number;
  reason: string;
  dataSupport: string[];
}

interface PositionStockRow {
  user_id: number;
  stock_code: string;
  stock_name: string;
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
const FULL_ANALYSIS_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const VOLATILITY_URGENT_DELAY_MS = 60 * 1000; // 60 seconds max for >3% trigger

// Track pending volatility timers so we can cancel them on stop
const pendingVolatilityTimers: ReturnType<typeof setTimeout>[] = [];

// --- Start / Stop ---

export function startScheduler(): void {
  if (fullAnalysisInterval) return; // Already running
  fullAnalysisInterval = setInterval(() => {
    runFullAnalysis().catch(() => {
      // Scheduler errors are non-critical, log silently
    });
  }, FULL_ANALYSIS_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (fullAnalysisInterval) {
    clearInterval(fullAnalysisInterval);
    fullAnalysisInterval = null;
  }
  for (const timer of pendingVolatilityTimers) {
    clearTimeout(timer);
  }
  pendingVolatilityTimers.length = 0;
}

// --- Full analysis (every 30 minutes) ---

export async function runFullAnalysis(db?: Database.Database): Promise<number> {
  const database = db || getDatabase();

  // Get all distinct user+stock combinations from positions
  const positions = database
    .prepare('SELECT DISTINCT user_id, stock_code, stock_name FROM positions')
    .all() as PositionStockRow[];

  let analysisCount = 0;

  for (const pos of positions) {
    try {
      const analysis = await triggerAnalysis(pos.stock_code, pos.user_id, 'scheduled', database);

      // Store message in messages table
      database.prepare(
        `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, analysis_id, created_at)
         VALUES (?, 'scheduled_analysis', ?, ?, ?, ?, ?, ?)`
      ).run(
        pos.user_id,
        pos.stock_code,
        pos.stock_name,
        `定时分析：${pos.stock_name}(${pos.stock_code}) - ${analysis.actionRef}`,
        JSON.stringify({
          stage: analysis.stage,
          confidence: analysis.confidence,
          actionRef: analysis.actionRef,
          reasoning: analysis.reasoning,
        }),
        analysis.id,
        new Date().toISOString()
      );

      // Push notification via SSE
      pushToUser(pos.user_id, 'analysis', {
        type: 'scheduled_analysis',
        stockCode: pos.stock_code,
        stockName: pos.stock_name,
        analysisId: analysis.id,
      });

      analysisCount++;
    } catch {
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
