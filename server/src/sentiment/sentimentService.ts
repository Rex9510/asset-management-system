/**
 * 市场情绪指数服务
 *
 * 纯规则引擎，零AI调用。
 * 基于成交量/20日均量比值 + 上证涨跌幅 + 沪深300涨跌幅加权计算，输出0-100整数。
 *
 * 计算公式（加权）：
 * - 成交量组件（40%权重）：volumeRatio = 当日成交量 / 20日均量
 *   映射到0-100：ratio < 0.5 → 0, 0.5-1.5 → 线性0-50, > 1.5 → 50 + (ratio-1.5)*25 上限100
 * - 上证涨跌幅组件（30%权重）：
 *   映射到0-100：change < -3% → 0, -3%~+3% → 线性0-100, > +3% → 100
 * - 沪深300涨跌幅组件（30%权重）：同上证映射
 *
 * 最终 score = round(volumeScore * 0.4 + shScore * 0.3 + hs300Score * 0.3)，clamp [0, 100]
 *
 * 标签映射：
 * 0-25 → 极度恐慌😱, 25-45 → 恐慌😰, 45-55 → 中性😐, 55-75 → 贪婪😊, 75-100 → 极度贪婪🤑
 */
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import axios from 'axios';

// --- Types ---

export interface SentimentData {
  score: number;
  label: string;
  emoji: string;
  components: {
    volumeRatio: number;
    shChangePercent: number;
    hs300ChangePercent: number;
  };
  updatedAt: string;
}

export interface SentimentLabel {
  label: string;
  emoji: string;
}

// --- Constants ---

const VOLUME_WEIGHT = 0.4;
const SH_WEIGHT = 0.3;
const HS300_WEIGHT = 0.3;

const INDEX_CODES = {
  sh: '000001',
  hs300: '399300',
};

// --- Core pure functions (exported for testing) ---

/**
 * Map volume ratio to a 0-100 score.
 * ratio < 0.5 → 0
 * 0.5 <= ratio <= 1.5 → linear 0-50
 * ratio > 1.5 → 50 + (ratio - 1.5) * 25, capped at 100
 */
export function mapVolumeScore(ratio: number): number {
  if (ratio < 0.5) return 0;
  if (ratio <= 1.5) {
    return ((ratio - 0.5) / 1.0) * 50;
  }
  return Math.min(100, 50 + (ratio - 1.5) * 25);
}

/**
 * Map index change percent to a 0-100 score.
 * change < -3% → 0
 * -3% <= change <= +3% → linear 0-100
 * change > +3% → 100
 */
export function mapChangeScore(changePercent: number): number {
  if (changePercent <= -3) return 0;
  if (changePercent >= 3) return 100;
  return ((changePercent + 3) / 6) * 100;
}

/**
 * Calculate the final sentiment score (0-100 integer).
 */
export function calculateSentimentScore(
  volumeRatio: number,
  shChange: number,
  hs300Change: number
): number {
  const volumeScore = mapVolumeScore(volumeRatio);
  const shScore = mapChangeScore(shChange);
  const hs300Score = mapChangeScore(hs300Change);

  const raw = volumeScore * VOLUME_WEIGHT + shScore * SH_WEIGHT + hs300Score * HS300_WEIGHT;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

/**
 * Map a sentiment score to its label and emoji.
 * 0-25  → 极度恐慌 😱
 * 25-45 → 恐慌 😰
 * 45-55 → 中性 😐
 * 55-75 → 贪婪 😊
 * 75-100 → 极度贪婪 🤑
 *
 * Boundary convention: lower bound inclusive, upper bound exclusive,
 * except 100 which belongs to 极度贪婪.
 */
export function getSentimentLabel(score: number): SentimentLabel {
  if (score < 25) return { label: '极度恐慌', emoji: '😱' };
  if (score < 45) return { label: '恐慌', emoji: '😰' };
  if (score < 55) return { label: '中性', emoji: '😐' };
  if (score < 75) return { label: '贪婪', emoji: '😊' };
  return { label: '极度贪婪', emoji: '🤑' };
}


// --- DB helpers ---

/**
 * Get volume data from market_history for a stock code.
 * Returns volumes in chronological order (oldest first).
 */
function getVolumeHistory(
  stockCode: string,
  days: number,
  db: Database.Database
): { volume: number; date: string }[] {
  const rows = db.prepare(
    `SELECT trade_date, volume FROM market_history
     WHERE stock_code = ? ORDER BY trade_date DESC LIMIT ?`
  ).all(stockCode, days) as { trade_date: string; volume: number }[];

  // Reverse to chronological order
  return rows.reverse().map(r => ({ volume: r.volume, date: r.trade_date }));
}

/**
 * Get the latest change percent from market_cache for a stock code.
 */
function getChangePercentFromCache(
  stockCode: string,
  db: Database.Database
): number | null {
  const row = db.prepare(
    `SELECT change_percent FROM market_cache WHERE stock_code = ?`
  ).get(stockCode) as { change_percent: number } | undefined;

  return row ? row.change_percent : null;
}

/**
 * Calculate volume ratio: today's volume / 20-day average volume.
 * Uses market_history data.
 */
function calculateVolumeRatio(stockCode: string, db: Database.Database): number {
  const data = getVolumeHistory(stockCode, 21, db);
  if (data.length < 2) return 1;

  const todayVolume = data[data.length - 1].volume;
  // Use up to 20 previous days (excluding today) for the average
  const previousDays = data.slice(0, -1).slice(-20);
  if (previousDays.length === 0) return 1;

  const avgVolume = previousDays.reduce((sum, d) => sum + d.volume, 0) / previousDays.length;
  return avgVolume > 0 ? todayVolume / avgVolume : 1;
}

// --- Main functions ---

/**
 * Read the latest sentiment data from the sentiment_index table.
 */
export function getCurrentSentiment(db?: Database.Database): SentimentData | null {
  const database = db || getDatabase();

  const row = database.prepare(
    `SELECT * FROM sentiment_index ORDER BY updated_at DESC LIMIT 1`
  ).get() as {
    id: number;
    score: number;
    label: string;
    volume_ratio: number;
    sh_change_percent: number;
    hs300_change_percent: number;
    updated_at: string;
  } | undefined;

  if (!row) return null;

  const { emoji } = getSentimentLabel(row.score);

  return {
    score: row.score,
    label: row.label,
    emoji,
    components: {
      volumeRatio: row.volume_ratio,
      shChangePercent: row.sh_change_percent,
      hs300ChangePercent: row.hs300_change_percent,
    },
    updatedAt: row.updated_at,
  };
}

/**
 * Fetch index change percent directly from Sina API.
 * Index codes need special prefix: sh000001 for 上证, sz399300 for 沪深300.
 * Uses the s_ prefix for index summary data.
 */
async function fetchIndexFromSina(stockCode: string): Promise<{ name: string; price: number; changePercent: number; volume: number }> {
  const prefix = stockCode.startsWith('39') ? 'sz' : 'sh';
  const symbol = `s_${prefix}${stockCode}`;
  const url = `https://hq.sinajs.cn/list=${symbol}`;
  const response = await axios.get(url, {
    timeout: 3000,
    responseType: 'arraybuffer',
    headers: { Referer: 'https://finance.sina.com.cn' },
  });
  const text = new TextDecoder('gbk').decode(Buffer.from(response.data));
  const match = text.match(/"(.+)"/);
  if (!match || !match[1]) throw new Error('Sina index data invalid');
  // s_ format: 名称,当前点位,涨跌点数,涨跌幅%,成交量(手),成交额(万)
  const parts = match[1].split(',');
  return {
    name: parts[0],
    price: parseFloat(parts[1]),
    changePercent: parseFloat(parts[3]),
    volume: parseFloat(parts[4]) || 0,
  };
}

/**
 * Calculate sentiment from current market data and write to sentiment_index table.
 * Called after each trading day close.
 * Now also fetches fresh index data from API to ensure accurate change percents.
 */
export function updateSentiment(db?: Database.Database): SentimentData {
  const database = db || getDatabase();

  // 1. Calculate volume ratio from Shanghai index history
  const volumeRatio = calculateVolumeRatio(INDEX_CODES.sh, database);

  // 2. Get change percents from market_cache (may have been refreshed by startup)
  const shChange = getChangePercentFromCache(INDEX_CODES.sh, database) ?? 0;
  const hs300Change = getChangePercentFromCache(INDEX_CODES.hs300, database) ?? 0;

  // 3. Calculate score
  const score = calculateSentimentScore(volumeRatio, shChange, hs300Change);
  const { label, emoji } = getSentimentLabel(score);

  const now = new Date().toISOString();

  // 4. Write to sentiment_index table
  database.prepare(
    `INSERT INTO sentiment_index (score, label, volume_ratio, sh_change_percent, hs300_change_percent, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    score,
    label,
    Math.round(volumeRatio * 100) / 100,
    Math.round(shChange * 100) / 100,
    Math.round(hs300Change * 100) / 100,
    now
  );

  return {
    score,
    label,
    emoji,
    components: {
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      shChangePercent: Math.round(shChange * 100) / 100,
      hs300ChangePercent: Math.round(hs300Change * 100) / 100,
    },
    updatedAt: now,
  };
}


/**
 * 启动时刷新指数行情到 market_cache，确保情绪计算有最新数据。
 * 指数代码不是标准A股代码，无法通过 getQuote 拉取，需要直接调用 Sina API。
 */
export async function refreshIndexQuotes(db?: Database.Database): Promise<void> {
  const database = db || getDatabase();
  const indexCodes = [INDEX_CODES.sh, INDEX_CODES.hs300];

  for (const code of indexCodes) {
    try {
      const data = await fetchIndexFromSina(code);
      const now = new Date().toISOString();
      database.prepare(
        `INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(code, data.name, data.price, data.changePercent, data.volume, now);
      console.log(`  指数行情刷新: ${data.name}(${code}) ${data.changePercent >= 0 ? '+' : ''}${data.changePercent.toFixed(2)}%`);
    } catch (err) {
      console.error(`  指数行情拉取失败: ${code}`, err);
    }
  }
}
