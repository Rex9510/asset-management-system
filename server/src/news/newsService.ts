import axios from 'axios';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { isValidStockCode } from '../positions/positionService';
import { Errors } from '../errors/AppError';

export interface NewsItem {
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  url: string;
}

const TIMEOUT_MS = 3000;
const CACHE_TTL_MINUTES = 30;

/**
 * Get market prefix for East Money news API.
 * Shanghai (6xxxxx) => '1', Shenzhen (0xxxxx/3xxxxx) => '0'
 */
function getEastMoneyMarketCode(stockCode: string): string {
  return stockCode.charAt(0) === '6' ? '1' : '0';
}

/**
 * Fetch news from East Money (东方财富) public API.
 * 3-second timeout.
 */
export async function fetchFromEastMoney(stockCode: string): Promise<NewsItem[]> {
  const marketCode = getEastMoneyMarketCode(stockCode);
  const url = `https://search-api-web.eastmoney.com/search/jsonp?type=14&pageindex=1&pagesize=10&keyword=${stockCode}&name=EA${marketCode}`;
  const response = await axios.get(url, {
    timeout: TIMEOUT_MS,
    responseType: 'text',
  });

  const text = response.data as string;
  // Try to parse JSONP response: callback({...})
  const jsonMatch = text.match(/\((\{[\s\S]*\})\)/);
  if (!jsonMatch || !jsonMatch[1]) {
    throw new Error('East Money news returned invalid data');
  }

  const parsed = JSON.parse(jsonMatch[1]);
  const items = parsed?.Data?.List || parsed?.data?.list || [];

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('East Money news returned empty data');
  }

  return items.map((item: Record<string, string>) => ({
    title: item.Title || item.title || '',
    summary: (item.Content || item.content || '').replace(/<[^>]+>/g, '').slice(0, 200),
    source: item.MediaName || item.mediaName || '东方财富',
    publishedAt: item.Date || item.date || new Date().toISOString(),
    url: item.Url || item.url || '',
  }));
}

/**
 * Fetch news from Sina Finance (新浪财经) public API.
 * 3-second timeout.
 */
export async function fetchFromSina(stockCode: string): Promise<NewsItem[]> {
  const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&k=${stockCode}&num=10`;
  const response = await axios.get(url, {
    timeout: TIMEOUT_MS,
    headers: { Referer: 'https://finance.sina.com.cn' },
  });

  const data = response.data;
  const items = data?.result?.data || [];

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Sina news returned empty data');
  }

  return items.map((item: Record<string, string | number>) => ({
    title: String(item.title || ''),
    summary: String(item.intro || item.summary || '').slice(0, 200),
    source: String(item.media_name || item.author || '新浪财经'),
    publishedAt: item.ctime
      ? new Date(Number(item.ctime) * 1000).toISOString()
      : new Date().toISOString(),
    url: String(item.url || item.link || ''),
  }));
}

// --- Cache operations ---

interface NewsCacheRow {
  id: number;
  stock_code: string;
  title: string;
  summary: string;
  source: string;
  published_at: string;
  url: string;
  fetched_at: string;
}

function getFromCache(stockCode: string, limit: number, db: Database.Database): NewsItem[] | null {
  const cutoff = new Date(Date.now() - CACHE_TTL_MINUTES * 60 * 1000).toISOString();

  const rows = db
    .prepare(
      `SELECT * FROM news_cache
       WHERE stock_code = ? AND fetched_at > ?
       ORDER BY published_at DESC
       LIMIT ?`
    )
    .all(stockCode, cutoff, limit) as NewsCacheRow[];

  if (rows.length === 0) return null;

  return rows.map((row) => ({
    title: row.title,
    summary: row.summary,
    source: row.source,
    publishedAt: row.published_at,
    url: row.url || '',
  }));
}

function saveToCache(stockCode: string, items: NewsItem[], db: Database.Database): void {
  const now = new Date().toISOString();

  // Clear old cache for this stock
  db.prepare('DELETE FROM news_cache WHERE stock_code = ?').run(stockCode);

  const insert = db.prepare(
    `INSERT INTO news_cache (stock_code, title, summary, source, published_at, url, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction((newsItems: NewsItem[]) => {
    for (const item of newsItems) {
      insert.run(stockCode, item.title, item.summary, item.source, item.publishedAt, item.url, now);
    }
  });

  insertMany(items);
}

// --- Main getNews function ---

/**
 * Get news for a stock with multi-source failover and 30-minute cache.
 * Tries East Money first, then Sina on failure.
 * Returns empty array if all sources fail (never throws).
 */
export async function getNews(
  stockCode: string,
  limit: number = 10,
  db?: Database.Database
): Promise<NewsItem[]> {
  if (!isValidStockCode(stockCode)) {
    throw Errors.badRequest('股票代码无效，请输入正确的A股代码（6位数字）');
  }

  const database = db || getDatabase();

  // Check cache first
  const cached = getFromCache(stockCode, limit, database);
  if (cached) {
    return cached;
  }

  // Try East Money (primary)
  try {
    const items = await fetchFromEastMoney(stockCode);
    try { saveToCache(stockCode, items, database); } catch { /* cache save non-critical */ }
    return items.slice(0, limit);
  } catch {
    // Primary failed, try Sina (backup)
  }

  // Try Sina (backup)
  try {
    const items = await fetchFromSina(stockCode);
    try { saveToCache(stockCode, items, database); } catch { /* cache save non-critical */ }
    return items.slice(0, limit);
  } catch {
    // Backup also failed
  }

  // All sources failed - return empty array, never throw
  return [];
}
