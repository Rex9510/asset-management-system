import axios from 'axios';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { Errors } from '../errors/AppError';
import { isValidStockCode } from '../positions/positionService';

export interface MarketQuote {
  stockCode: string;
  stockName: string;
  price: number;
  changePercent: number;
  volume: number;
  timestamp: string;
  delayed?: boolean;
}

type DataSource = 'eastmoney' | 'sina' | 'tencent';

const SOURCE_ORDER: DataSource[] = ['eastmoney', 'sina', 'tencent'];
const PRIMARY_SOURCE: DataSource = 'eastmoney';
const TIMEOUT_MS = 2000;
const SWITCHBACK_THRESHOLD = 3;

// Internal state for source switching
let currentSource: DataSource = PRIMARY_SOURCE;
let consecutiveSuccessCount = 0;

/** Reset internal state (for testing) */
export function resetSourceState(): void {
  currentSource = PRIMARY_SOURCE;
  consecutiveSuccessCount = 0;
}

/** Get current source (for testing) */
export function getCurrentSource(): DataSource {
  return currentSource;
}

/**
 * Determine market prefix for a stock code.
 * Shanghai (6xxxxx) => 'sh', Shenzhen (0xxxxx/3xxxxx) => 'sz'
 * STAR Market (688xxx/689xxx) => 'sh'
 */
export function getMarketPrefix(stockCode: string): 'sh' | 'sz' {
  const first = stockCode.charAt(0);
  if (first === '6') return 'sh';
  return 'sz';
}

/**
 * Get East Money secid: 1.CODE for Shanghai, 0.CODE for Shenzhen
 */
function getEastMoneySecId(stockCode: string): string {
  const prefix = getMarketPrefix(stockCode);
  return prefix === 'sh' ? `1.${stockCode}` : `0.${stockCode}`;
}

// --- Data source fetchers ---

export async function fetchFromEastMoney(stockCode: string): Promise<MarketQuote> {
  const secid = getEastMoneySecId(stockCode);
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f57,f58,f170`;
  const response = await axios.get(url, { timeout: TIMEOUT_MS });
  const data = response.data?.data;
  if (!data || !data.f57) {
    throw new Error('East Money returned invalid data');
  }
  return {
    stockCode: data.f57,
    stockName: data.f58 || stockCode,
    price: data.f43 / 100,       // East Money returns price in cents
    changePercent: data.f170 / 100, // percentage in basis points
    volume: data.f47,
    timestamp: new Date().toISOString(),
  };
}

export async function fetchFromSina(stockCode: string): Promise<MarketQuote> {
  const prefix = getMarketPrefix(stockCode);
  const symbol = `${prefix}${stockCode}`;
  const url = `https://hq.sinajs.cn/list=${symbol}`;
  const response = await axios.get(url, {
    timeout: TIMEOUT_MS,
    responseType: 'text',
    headers: { Referer: 'https://finance.sina.com.cn' },
  });
  const text = response.data as string;
  // Format: var hq_str_sh600000="浦发银行,11.58,11.57,...";
  const match = text.match(/"(.+)"/);
  if (!match || !match[1]) {
    throw new Error('Sina returned invalid data');
  }
  const parts = match[1].split(',');
  if (parts.length < 32) {
    throw new Error('Sina data format unexpected');
  }
  const name = parts[0];
  const price = parseFloat(parts[3]);
  const prevClose = parseFloat(parts[2]);
  const volume = parseFloat(parts[8]);
  const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
  return {
    stockCode,
    stockName: name,
    price,
    changePercent,
    volume,
    timestamp: new Date().toISOString(),
  };
}

export async function fetchFromTencent(stockCode: string): Promise<MarketQuote> {
  const prefix = getMarketPrefix(stockCode);
  const symbol = `${prefix}${stockCode}`;
  const url = `https://qt.gtimg.cn/q=${symbol}`;
  const response = await axios.get(url, {
    timeout: TIMEOUT_MS,
    responseType: 'text',
  });
  const text = response.data as string;
  // Format: v_sh600000="1~浦发银行~600000~11.58~11.57~...";
  const match = text.match(/"(.+)"/);
  if (!match || !match[1]) {
    throw new Error('Tencent returned invalid data');
  }
  const parts = match[1].split('~');
  if (parts.length < 45) {
    throw new Error('Tencent data format unexpected');
  }
  const name = parts[1];
  const price = parseFloat(parts[3]);
  const changePercent = parseFloat(parts[32]);
  const volume = parseFloat(parts[6]);
  return {
    stockCode,
    stockName: name,
    price,
    changePercent,
    volume,
    timestamp: new Date().toISOString(),
  };
}

const FETCHERS: Record<DataSource, (code: string) => Promise<MarketQuote>> = {
  eastmoney: fetchFromEastMoney,
  sina: fetchFromSina,
  tencent: fetchFromTencent,
};

// --- Cache operations ---

function saveToCache(quote: MarketQuote, db?: Database.Database): void {
  const database = db || getDatabase();
  database
    .prepare(
      `INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(quote.stockCode, quote.stockName, quote.price, quote.changePercent, quote.volume, quote.timestamp);
}

function getFromCache(stockCode: string, db?: Database.Database): MarketQuote | null {
  const database = db || getDatabase();
  const row = database
    .prepare('SELECT * FROM market_cache WHERE stock_code = ?')
    .get(stockCode) as {
      stock_code: string;
      stock_name: string;
      price: number;
      change_percent: number;
      volume: number;
      updated_at: string;
    } | undefined;

  if (!row) return null;

  return {
    stockCode: row.stock_code,
    stockName: row.stock_name,
    price: row.price,
    changePercent: row.change_percent,
    volume: row.volume || 0,
    timestamp: row.updated_at,
    delayed: true,
  };
}

// --- Source switching logic ---

function getSourceOrder(): DataSource[] {
  const idx = SOURCE_ORDER.indexOf(currentSource);
  const ordered: DataSource[] = [];
  for (let i = 0; i < SOURCE_ORDER.length; i++) {
    ordered.push(SOURCE_ORDER[(idx + i) % SOURCE_ORDER.length]);
  }
  return ordered;
}

function onSourceSuccess(source: DataSource): void {
  if (source === PRIMARY_SOURCE) {
    // Already on primary, reset counter
    currentSource = PRIMARY_SOURCE;
    consecutiveSuccessCount = 0;
    return;
  }

  currentSource = source;
  consecutiveSuccessCount++;

  // After SWITCHBACK_THRESHOLD consecutive successes on backup, try switching back to primary
  if (consecutiveSuccessCount >= SWITCHBACK_THRESHOLD) {
    currentSource = PRIMARY_SOURCE;
    consecutiveSuccessCount = 0;
  }
}

function onSourceFailure(failedSource: DataSource): void {
  // Move to next source in order
  const idx = SOURCE_ORDER.indexOf(failedSource);
  const nextIdx = (idx + 1) % SOURCE_ORDER.length;
  currentSource = SOURCE_ORDER[nextIdx];
  consecutiveSuccessCount = 0;
}

// --- Main getQuote function ---

/**
 * Get a stock quote with multi-source failover.
 * Tries sources in order starting from currentSource.
 * On all failures, returns cached data with delayed flag.
 */
export async function getQuote(stockCode: string, db?: Database.Database): Promise<MarketQuote> {
  if (!isValidStockCode(stockCode)) {
    throw Errors.badRequest('股票代码无效，请输入正确的A股代码（6位数字）');
  }

  const sourcesToTry = getSourceOrder();

  for (const source of sourcesToTry) {
    try {
      const fetcher = FETCHERS[source];
      const quote = await fetcher(stockCode);
      onSourceSuccess(source);
      // Cache the successful result
      try {
        saveToCache(quote, db);
      } catch {
        // Cache save failure is non-critical
      }
      return quote;
    } catch {
      onSourceFailure(source);
    }
  }

  // All sources failed, try cache
  const cached = getFromCache(stockCode, db);
  if (cached) {
    return cached;
  }

  throw Errors.internal('所有行情数据源不可用，且无缓存数据');
}
