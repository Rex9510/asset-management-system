/**
 * 估值分位服务
 *
 * 功能：
 * 1. 多源降级获取当前 PE/PB：腾讯 qt.gtimg.cn → 新浪 → 数据库缓存 → AI估算
 * 2. PE 分位（优先）：东财财报 CPD 拆解单季 EPS → 滚动 TTM，按公告日匹配日 K 得到真实历史 PE 再分位
 * 3. PE/PB 分位（兜底）：历史价缩放近似（EPS/BPS 不变的简化假设）
 * 4. 区间映射：0-30%→low, 30-70%→fair, 70-100%→high
 * 5. 数据年限标注：不足10年时标注实际年限（K 线跨度）
 * 6. 写入 valuation_cache 表，每交易日收盘后更新
 * 7. 批量初始化：队列逐只处理，500ms 间隔
 */
import axios from 'axios';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { getMarketPrefix } from '../market/marketDataService';
import { tryFundamentalPePbPercentiles } from './fundamentalPeService';

// --- Types ---

export type ValuationZone = 'low' | 'fair' | 'high';
export type ValuationSource = 'tencent' | 'sina' | 'cache' | 'ai_estimate';

export interface ValuationData {
  stockCode: string;
  peValue: number | null;
  pbValue: number | null;
  pePercentile: number;
  pbPercentile: number;
  peZone: ValuationZone;
  pbZone: ValuationZone;
  dataYears: number;
  source: ValuationSource;
  updatedAt: string;
}

export interface PePbData {
  pe: number | null;
  pb: number | null;
  price: number;
  source: ValuationSource;
}

// --- Zone mapping ---

/**
 * 将百分位数值映射到估值区间
 * 0-30% → low, 30-70% → fair, 70-100% → high
 */
export function mapPercentileToZone(percentile: number): ValuationZone {
  if (percentile < 30) return 'low';
  if (percentile < 70) return 'fair';
  return 'high';
}

// --- PE/PB fetching with multi-source fallback ---

/**
 * 从腾讯行情接口获取PE/PB
 * 腾讯 qt.gtimg.cn 返回 GBK 编码，需要 arraybuffer + TextDecoder('gbk')
 * 字段索引：parts[39]=PE(TTM), parts[46]=PB, parts[3]=当前价
 */
export async function fetchPePbFromTencent(stockCode: string): Promise<PePbData> {
  const prefix = getMarketPrefix(stockCode);
  const symbol = `${prefix}${stockCode}`;
  const url = `https://qt.gtimg.cn/q=${symbol}`;

  const response = await axios.get(url, {
    timeout: 5000,
    responseType: 'arraybuffer',
  });

  const text = new TextDecoder('gbk').decode(Buffer.from(response.data));
  const match = text.match(/"(.+)"/);
  if (!match || !match[1]) {
    throw new Error('Tencent returned invalid data for PE/PB');
  }

  const parts = match[1].split('~');
  if (parts.length < 47) {
    throw new Error('Tencent data format unexpected for PE/PB');
  }

  const price = parseFloat(parts[3]);
  const pe = parseFloat(parts[39]);
  const pb = parseFloat(parts[46]);

  if (!price || price <= 0) {
    throw new Error('Tencent returned invalid price');
  }

  return {
    pe: isNaN(pe) || pe <= 0 ? null : pe,
    pb: isNaN(pb) || pb <= 0 ? null : pb,
    price,
    source: 'tencent',
  };
}

/**
 * 从新浪行情接口获取PE/PB
 * 新浪返回 GBK 编码，需要 arraybuffer + TextDecoder('gbk')
 * 新浪基础行情不直接返回PE/PB，需要通过财务接口
 * 使用 money.finance.sina.com.cn 获取财务数据
 */
export async function fetchPePbFromSina(stockCode: string): Promise<PePbData> {
  const prefix = getMarketPrefix(stockCode);
  const symbol = `${prefix}${stockCode}`;

  // 先获取当前价格
  const priceUrl = `https://hq.sinajs.cn/list=${symbol}`;
  const priceResp = await axios.get(priceUrl, {
    timeout: 5000,
    responseType: 'arraybuffer',
    headers: { Referer: 'https://finance.sina.com.cn' },
  });
  const priceText = new TextDecoder('gbk').decode(Buffer.from(priceResp.data));
  const priceMatch = priceText.match(/"(.+)"/);
  if (!priceMatch || !priceMatch[1]) {
    throw new Error('Sina returned invalid price data');
  }
  const priceParts = priceMatch[1].split(',');
  if (priceParts.length < 4) {
    throw new Error('Sina price data format unexpected');
  }
  const price = parseFloat(priceParts[3]);
  if (!price || price <= 0) {
    throw new Error('Sina returned invalid price');
  }

  // 获取PE/PB（通过新浪财务摘要接口）
  const finUrl = `https://finance.sina.com.cn/realstock/company/${symbol}/jsvar.js`;
  let pe: number | null = null;
  let pb: number | null = null;

  try {
    const finResp = await axios.get(finUrl, {
      timeout: 5000,
      responseType: 'arraybuffer',
    });
    const finText = new TextDecoder('gbk').decode(Buffer.from(finResp.data));

    // 尝试解析PE
    const peMatch = finText.match(/pe_d["\s]*[:=]\s*([\d.]+)/i);
    if (peMatch) {
      const peVal = parseFloat(peMatch[1]);
      if (!isNaN(peVal) && peVal > 0) pe = peVal;
    }

    // 尝试解析PB
    const pbMatch = finText.match(/pb["\s]*[:=]\s*([\d.]+)/i);
    if (pbMatch) {
      const pbVal = parseFloat(pbMatch[1]);
      if (!isNaN(pbVal) && pbVal > 0) pb = pbVal;
    }
  } catch {
    // 财务接口失败，仅返回价格
  }

  return { pe, pb, price, source: 'sina' };
}

/**
 * 从数据库缓存获取PE/PB
 */
export function fetchPePbFromCache(stockCode: string, db?: Database.Database): PePbData | null {
  const database = db || getDatabase();
  const row = database.prepare(
    'SELECT pe_value, pb_value, source FROM valuation_cache WHERE stock_code = ?'
  ).get(stockCode) as { pe_value: number | null; pb_value: number | null; source: string } | undefined;

  if (!row || (row.pe_value === null && row.pb_value === null)) {
    return null;
  }

  // 获取当前价格（从 market_cache）
  const priceRow = database.prepare(
    'SELECT price FROM market_cache WHERE stock_code = ?'
  ).get(stockCode) as { price: number } | undefined;

  return {
    pe: row.pe_value,
    pb: row.pb_value,
    price: priceRow?.price || 0,
    source: 'cache',
  };
}

/**
 * AI估算PE/PB（降级方案，使用"参考方案"措辞）
 * 仅在首次无缓存且所有接口都失败时使用
 */
export async function estimatePePbFromAI(stockCode: string): Promise<PePbData> {
  try {
    const { getAIProvider } = require('../ai/aiProviderFactory');
    const provider = getAIProvider();
    const response = await provider.chat(
      [{ role: 'user', content: `请估算A股股票代码${stockCode}的大致PE(TTM)和PB值范围。仅返回JSON格式：{"pe": 数值, "pb": 数值}。如果无法估算，返回{"pe": null, "pb": null}。这是参考方案，不构成投资依据。` }],
      '你是一个金融数据助手，仅提供参考数据估算，不提供投资建议。'
    );

    const jsonMatch = response.match(/\{[^}]*"pe"[^}]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        pe: typeof parsed.pe === 'number' && parsed.pe > 0 ? parsed.pe : null,
        pb: typeof parsed.pb === 'number' && parsed.pb > 0 ? parsed.pb : null,
        price: 0,
        source: 'ai_estimate',
      };
    }
  } catch {
    // AI估算失败
  }

  return { pe: null, pb: null, price: 0, source: 'ai_estimate' };
}

/**
 * 多源降级获取PE/PB
 * 降级链：腾讯 → 新浪 → 数据库缓存 → AI估算
 */
export async function fetchPePbWithFallback(
  stockCode: string,
  db?: Database.Database
): Promise<PePbData> {
  // 1. 腾讯
  try {
    const data = await fetchPePbFromTencent(stockCode);
    if (data.pe !== null || data.pb !== null) return data;
  } catch {
    // 腾讯失败，继续降级
  }

  // 2. 新浪
  try {
    const data = await fetchPePbFromSina(stockCode);
    if (data.pe !== null || data.pb !== null) return data;
  } catch {
    // 新浪失败，继续降级
  }

  // 3. 数据库缓存
  const cached = fetchPePbFromCache(stockCode, db);
  if (cached) return cached;

  // 4. AI估算（最后降级）
  return await estimatePePbFromAI(stockCode);
}

// --- Percentile calculation ---

/**
 * 从 market_history 表获取历史收盘价
 */
export function getHistoricalPrices(
  stockCode: string,
  db?: Database.Database
): { tradeDate: string; closePrice: number }[] {
  const database = db || getDatabase();
  return database.prepare(
    'SELECT trade_date as tradeDate, close_price as closePrice FROM market_history WHERE stock_code = ? ORDER BY trade_date ASC'
  ).all(stockCode) as { tradeDate: string; closePrice: number }[];
}

/**
 * 反推历史PE序列
 * 公式：历史PE = 当前PE × (当前价 / 历史价) 的倒数
 * 即：历史PE = 当前PE × 历史价 / 当前价
 * 
 * 原理：PE = 价格 / EPS，假设EPS在短期内不变
 * 当前PE / 当前价 = 1/EPS
 * 历史PE = 历史价 × (1/EPS) = 历史价 × 当前PE / 当前价
 * 
 * 注意：这是一个近似方法，实际EPS会随季报变化
 */
export function computeHistoricalPeSeries(
  currentPe: number,
  currentPrice: number,
  historicalPrices: { tradeDate: string; closePrice: number }[]
): { tradeDate: string; pe: number }[] {
  if (currentPrice <= 0 || currentPe <= 0) return [];

  return historicalPrices
    .filter(p => p.closePrice > 0)
    .map(p => ({
      tradeDate: p.tradeDate,
      pe: currentPe * p.closePrice / currentPrice,
    }));
}

/**
 * 计算分位数
 * percentile = rank(当前值在历史序列中的位置) / total × 100
 * rank = 小于当前值的数量
 */
export function calculatePercentile(currentValue: number, historicalValues: number[]): number {
  if (historicalValues.length === 0) return 50; // 无数据时默认50%

  const rank = historicalValues.filter(v => v < currentValue).length;
  return (rank / historicalValues.length) * 100;
}

/**
 * 计算数据年限
 */
export function calculateDataYears(
  historicalPrices: { tradeDate: string }[]
): number {
  if (historicalPrices.length < 2) return 0;

  const first = new Date(historicalPrices[0].tradeDate);
  const last = new Date(historicalPrices[historicalPrices.length - 1].tradeDate);
  const diffMs = last.getTime() - first.getTime();
  const years = diffMs / (365.25 * 24 * 60 * 60 * 1000);

  return Math.round(years * 10) / 10; // 保留1位小数
}

// --- Core valuation computation ---

/**
 * 计算单只股票的估值分位数据
 */
export async function computeValuation(
  stockCode: string,
  db?: Database.Database
): Promise<ValuationData> {
  const database = db || getDatabase();

  // 1. 多源降级获取PE/PB
  const pePbData = await fetchPePbWithFallback(stockCode, database);

  // 2. 获取历史收盘价
  const historicalPrices = getHistoricalPrices(stockCode, database);

  // 3. 计算数据年限
  const dataYears = calculateDataYears(historicalPrices);

  // 4–5. PE/PB 分位：优先财报 TTM + 公告日；否则价格缩放近似
  let pePercentile = 50;
  let pbPercentile = 50;

  const fund = await tryFundamentalPePbPercentiles(
    stockCode,
    historicalPrices,
    pePbData.price > 0 ? pePbData.price : null,
    pePbData.pe,
    pePbData.pb,
    calculatePercentile
  );

  if (fund != null) {
    pePercentile = fund.pePercentile;
    if (fund.pbFromFundamental && fund.pbPercentile != null) {
      pbPercentile = fund.pbPercentile;
    } else if (pePbData.pb !== null && pePbData.price > 0 && historicalPrices.length > 0) {
      const historicalPbSeries = historicalPrices
        .filter(p => p.closePrice > 0)
        .map(p => pePbData.pb! * p.closePrice / pePbData.price);
      pbPercentile = calculatePercentile(pePbData.pb, historicalPbSeries);
    }
  } else if (pePbData.pe !== null && pePbData.price > 0 && historicalPrices.length > 0) {
    const historicalPeSeries = computeHistoricalPeSeries(
      pePbData.pe, pePbData.price, historicalPrices
    );
    const peValues = historicalPeSeries.map(h => h.pe);
    pePercentile = calculatePercentile(pePbData.pe, peValues);

    if (pePbData.pb !== null && pePbData.price > 0) {
      const historicalPbSeries = historicalPrices
        .filter(p => p.closePrice > 0)
        .map(p => pePbData.pb! * p.closePrice / pePbData.price);
      pbPercentile = calculatePercentile(pePbData.pb, historicalPbSeries);
    }
  }

  // 6. 映射区间
  const peZone = mapPercentileToZone(pePercentile);
  const pbZone = mapPercentileToZone(pbPercentile);

  return {
    stockCode,
    peValue: pePbData.pe,
    pbValue: pePbData.pb,
    pePercentile: Math.round(pePercentile * 100) / 100,
    pbPercentile: Math.round(pbPercentile * 100) / 100,
    peZone,
    pbZone,
    dataYears,
    source: pePbData.source,
    updatedAt: new Date().toISOString(),
  };
}

// --- Database operations ---

/**
 * 将估值分位数据写入 valuation_cache 表
 */
export function saveValuationToDb(data: ValuationData, db?: Database.Database): void {
  const database = db || getDatabase();
  database.prepare(
    `INSERT OR REPLACE INTO valuation_cache (stock_code, pe_value, pb_value, pe_percentile, pb_percentile, pe_zone, pb_zone, data_years, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.stockCode,
    data.peValue,
    data.pbValue,
    data.pePercentile,
    data.pbPercentile,
    data.peZone,
    data.pbZone,
    data.dataYears,
    data.source,
    data.updatedAt
  );
}

/**
 * 从 valuation_cache 表读取估值分位数据
 */
export function getValuationFromDb(stockCode: string, db?: Database.Database): ValuationData | null {
  const database = db || getDatabase();
  const row = database.prepare(
    'SELECT * FROM valuation_cache WHERE stock_code = ?'
  ).get(stockCode) as {
    stock_code: string;
    pe_value: number | null;
    pb_value: number | null;
    pe_percentile: number | null;
    pb_percentile: number | null;
    pe_zone: string | null;
    pb_zone: string | null;
    data_years: number | null;
    source: string;
    updated_at: string;
  } | undefined;

  if (!row) return null;

  return {
    stockCode: row.stock_code,
    peValue: row.pe_value,
    pbValue: row.pb_value,
    pePercentile: row.pe_percentile ?? 50,
    pbPercentile: row.pb_percentile ?? 50,
    peZone: (row.pe_zone as ValuationZone) || 'fair',
    pbZone: (row.pb_zone as ValuationZone) || 'fair',
    dataYears: row.data_years ?? 0,
    source: row.source as ValuationSource,
    updatedAt: row.updated_at,
  };
}

/**
 * 清空 `valuation_cache` 全表，使估值接口下次按最新逻辑重算并写回缓存。
 * @returns 删除的行数
 */
export function clearValuationCache(db?: Database.Database): number {
  const database = db || getDatabase();
  const result = database.prepare('DELETE FROM valuation_cache').run();
  return result.changes;
}

// --- Batch processing ---

/**
 * 获取所有需要更新估值的股票代码（用户持仓去重）
 */
export function getStocksForValuation(db?: Database.Database): string[] {
  const database = db || getDatabase();
  const rows = database.prepare(
    'SELECT DISTINCT stock_code FROM positions'
  ).all() as { stock_code: string }[];
  return rows.map(r => r.stock_code);
}

/**
 * 批量更新所有用户持仓股票的估值分位
 * 队列逐只处理，500ms 间隔，避免2核2G服务器资源压力
 */
export async function batchUpdateValuations(
  db?: Database.Database,
  delayMs: number = 500
): Promise<{ total: number; success: number; failed: number }> {
  const database = db || getDatabase();
  const stockCodes = getStocksForValuation(database);

  if (stockCodes.length === 0) {
    return { total: 0, success: 0, failed: 0 };
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < stockCodes.length; i++) {
    const code = stockCodes[i];
    try {
      const data = await computeValuation(code, database);
      saveValuationToDb(data, database);
      success++;
    } catch {
      failed++;
    }

    // 500ms 间隔，最后一只不需要等待
    if (i < stockCodes.length - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return { total: stockCodes.length, success, failed };
}

/**
 * 获取单只股票的估值分位（优先缓存，缓存过期则重新计算）
 * 用于 API 接口调用
 */
export async function getValuation(
  stockCode: string,
  db?: Database.Database
): Promise<ValuationData> {
  const database = db || getDatabase();

  // 先查缓存
  const cached = getValuationFromDb(stockCode, database);
  if (cached) {
    // 检查是否是今天的数据
    const today = new Date().toISOString().slice(0, 10);
    const cachedDate = cached.updatedAt.slice(0, 10);
    if (cachedDate === today) {
      return cached;
    }
  }

  // 缓存不存在或过期，重新计算
  const data = await computeValuation(stockCode, database);
  saveValuationToDb(data, database);
  return data;
}
