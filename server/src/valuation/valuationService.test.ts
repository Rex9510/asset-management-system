import Database from 'better-sqlite3';
import axios from 'axios';
import { initializeDatabase } from '../db/init';
import {
  mapPercentileToZone,
  calculatePercentile,
  calculateDataYears,
  computeHistoricalPeSeries,
  fetchPePbFromTencent,
  fetchPePbFromSina,
  fetchPePbFromCache,
  fetchPePbWithFallback,
  computeValuation,
  saveValuationToDb,
  getValuationFromDb,
  clearValuationCache,
  getStocksForValuation,
  batchUpdateValuations,
  getValuation,
} from './valuationService';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock AI provider to avoid real API calls
jest.mock('../ai/aiProviderFactory', () => ({
  getAIProvider: () => ({
    chat: jest.fn().mockResolvedValue('{"pe": 15.5, "pb": 1.8}'),
    getModelName: () => 'deepseek-chat',
  }),
}));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db);
  return db;
}

function seedHistoricalPrices(db: Database.Database, stockCode: string, count: number, startYear: number = 2015) {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insert = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const date = new Date(startYear, 0, 1);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().slice(0, 10);
      // Simulate price fluctuation around 20 with some variance
      const price = 15 + Math.sin(i / 50) * 5 + (i / count) * 5;
      stmt.run(stockCode, dateStr, price - 0.5, price, price + 0.5, price - 1, 1000000 + i * 100);
    }
  });
  insert();
}

function seedUser(db: Database.Database): number {
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('testuser', 'hash');
  return (db.prepare('SELECT id FROM users WHERE username = ?').get('testuser') as { id: number }).id;
}

function seedPosition(db: Database.Database, userId: number, stockCode: string, stockName: string) {
  db.prepare(
    'INSERT INTO positions (user_id, stock_code, stock_name, position_type, cost_price, shares) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, stockCode, stockName, 'holding', 20.0, 100);
}

// Helper to build a Tencent-style response buffer
function buildTencentResponse(parts: string[]): Buffer {
  const padded = new Array(50).fill('0');
  parts.forEach((v, i) => { padded[i] = v; });
  const text = `v_sh600519="${padded.join('~')}";`;
  const encoder = new TextEncoder();
  return Buffer.from(encoder.encode(text));
}

function mockTencentPePbSuccess(pe: number = 25.5, pb: number = 8.2, price: number = 1800) {
  const parts = new Array(50).fill('0');
  parts[1] = '贵州茅台';
  parts[3] = String(price);
  parts[39] = String(pe);
  parts[46] = String(pb);
  const text = `v_sh600519="${parts.join('~')}";`;
  // Encode as UTF-8 (simulating GBK for test since TextDecoder('gbk') handles both for ASCII)
  mockedAxios.get.mockResolvedValueOnce({
    data: Buffer.from(text),
  });
}

function mockTencentPePbFailure() {
  mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));
}

function mockSinaPriceSuccess(price: number = 1800) {
  // Price response
  const priceText = `var hq_str_sh600519="贵州茅台,1795,1790,${price},1810,1785,1799,1800,50000000,90000000,100,1799,200,1798,300,1797,400,1796,500,1795,100,1800,200,1801,300,1802,400,1803,500,1804,2024-01-15,15:00:00,00,";`;
  mockedAxios.get.mockResolvedValueOnce({
    data: Buffer.from(priceText),
  });
  // Financial data response
  const finText = `var zhuli_data = {pe_d: 25.0, pb: 8.0};`;
  mockedAxios.get.mockResolvedValueOnce({
    data: Buffer.from(finText),
  });
}

function mockSinaFailure() {
  mockedAxios.get.mockRejectedValueOnce(new Error('Sina error'));
}

/** 东财 CPD 无数据，迫使 PE 分位走价格缩放兜底（测试稳定、不依赖外网） */
function mockEastMoneyCpdEmpty() {
  mockedAxios.get.mockResolvedValueOnce({
    data: { success: true, result: { pages: 1, data: [] } },
  });
}

describe('valuationService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    jest.clearAllMocks();
    mockedAxios.get.mockReset();
  });

  afterEach(() => {
    db.close();
  });

  describe('mapPercentileToZone', () => {
    it('should map 0-30% to low', () => {
      expect(mapPercentileToZone(0)).toBe('low');
      expect(mapPercentileToZone(15)).toBe('low');
      expect(mapPercentileToZone(29.99)).toBe('low');
    });

    it('should map 30-70% to fair', () => {
      expect(mapPercentileToZone(30)).toBe('fair');
      expect(mapPercentileToZone(50)).toBe('fair');
      expect(mapPercentileToZone(69.99)).toBe('fair');
    });

    it('should map 70-100% to high', () => {
      expect(mapPercentileToZone(70)).toBe('high');
      expect(mapPercentileToZone(85)).toBe('high');
      expect(mapPercentileToZone(100)).toBe('high');
    });
  });

  describe('calculatePercentile', () => {
    it('should calculate percentile correctly', () => {
      const values = [10, 20, 30, 40, 50];
      // 30 is greater than 10, 20 → rank=2, percentile=2/5*100=40
      expect(calculatePercentile(30, values)).toBe(40);
    });

    it('should return 0 for the minimum value', () => {
      const values = [10, 20, 30, 40, 50];
      expect(calculatePercentile(10, values)).toBe(0);
    });

    it('should return high percentile for the maximum value', () => {
      const values = [10, 20, 30, 40, 50];
      // 50 is greater than 10,20,30,40 → rank=4, percentile=80
      expect(calculatePercentile(50, values)).toBe(80);
    });

    it('should return 50 for empty array', () => {
      expect(calculatePercentile(10, [])).toBe(50);
    });

    it('should return 100 for value greater than all', () => {
      const values = [10, 20, 30];
      // 100 > all 3 → rank=3, percentile=100
      expect(calculatePercentile(100, values)).toBe(100);
    });
  });

  describe('calculateDataYears', () => {
    it('should calculate years from date range', () => {
      const prices = [
        { tradeDate: '2020-01-01' },
        { tradeDate: '2020-06-01' },
        { tradeDate: '2025-01-01' },
      ];
      const years = calculateDataYears(prices);
      expect(years).toBeGreaterThanOrEqual(4.9);
      expect(years).toBeLessThanOrEqual(5.1);
    });

    it('should return 0 for insufficient data', () => {
      expect(calculateDataYears([])).toBe(0);
      expect(calculateDataYears([{ tradeDate: '2024-01-01' }])).toBe(0);
    });
  });

  describe('computeHistoricalPeSeries', () => {
    it('should compute historical PE series correctly', () => {
      const currentPe = 20;
      const currentPrice = 100;
      const historicalPrices = [
        { tradeDate: '2024-01-01', closePrice: 50 },
        { tradeDate: '2024-06-01', closePrice: 100 },
        { tradeDate: '2024-12-01', closePrice: 150 },
      ];

      const series = computeHistoricalPeSeries(currentPe, currentPrice, historicalPrices);
      expect(series).toHaveLength(3);
      // PE at price 50: 20 * 50/100 = 10
      expect(series[0].pe).toBe(10);
      // PE at price 100: 20 * 100/100 = 20
      expect(series[1].pe).toBe(20);
      // PE at price 150: 20 * 150/100 = 30
      expect(series[2].pe).toBe(30);
    });

    it('should return empty for invalid inputs', () => {
      expect(computeHistoricalPeSeries(0, 100, [{ tradeDate: '2024-01-01', closePrice: 50 }])).toEqual([]);
      expect(computeHistoricalPeSeries(20, 0, [{ tradeDate: '2024-01-01', closePrice: 50 }])).toEqual([]);
    });

    it('should filter out zero-price entries', () => {
      const series = computeHistoricalPeSeries(20, 100, [
        { tradeDate: '2024-01-01', closePrice: 0 },
        { tradeDate: '2024-06-01', closePrice: 50 },
      ]);
      expect(series).toHaveLength(1);
    });
  });

  describe('fetchPePbFromTencent', () => {
    it('should parse PE/PB from Tencent response', async () => {
      mockTencentPePbSuccess(25.5, 8.2, 1800);
      const result = await fetchPePbFromTencent('600519');
      expect(result.pe).toBe(25.5);
      expect(result.pb).toBe(8.2);
      expect(result.price).toBe(1800);
      expect(result.source).toBe('tencent');
    });

    it('should throw on network error', async () => {
      mockTencentPePbFailure();
      await expect(fetchPePbFromTencent('600519')).rejects.toThrow();
    });
  });

  describe('fetchPePbFromCache', () => {
    it('should return null when no cache exists', () => {
      const result = fetchPePbFromCache('600519', db);
      expect(result).toBeNull();
    });

    it('should return cached data when available', () => {
      // Seed cache
      db.prepare(
        'INSERT INTO valuation_cache (stock_code, pe_value, pb_value, source, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run('600519', 25.0, 8.0, 'tencent', new Date().toISOString());

      // Seed market_cache for price
      db.prepare(
        'INSERT INTO market_cache (stock_code, stock_name, price, change_percent, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run('600519', '贵州茅台', 1800, 1.5, new Date().toISOString());

      const result = fetchPePbFromCache('600519', db);
      expect(result).not.toBeNull();
      expect(result!.pe).toBe(25.0);
      expect(result!.pb).toBe(8.0);
      expect(result!.source).toBe('cache');
      expect(result!.price).toBe(1800);
    });
  });

  describe('fetchPePbWithFallback', () => {
    it('should use Tencent as primary source', async () => {
      mockTencentPePbSuccess(25.5, 8.2, 1800);
      const result = await fetchPePbWithFallback('600519', db);
      expect(result.source).toBe('tencent');
      expect(result.pe).toBe(25.5);
    });

    it('should fallback to Sina when Tencent fails', async () => {
      mockTencentPePbFailure();
      mockSinaPriceSuccess(1800);
      const result = await fetchPePbWithFallback('600519', db);
      expect(result.source).toBe('sina');
    });

    it('should fallback to cache when Tencent and Sina fail', async () => {
      // Seed cache
      db.prepare(
        'INSERT INTO valuation_cache (stock_code, pe_value, pb_value, source, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run('600519', 24.0, 7.5, 'tencent', new Date().toISOString());
      db.prepare(
        'INSERT INTO market_cache (stock_code, stock_name, price, change_percent, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run('600519', '贵州茅台', 1800, 1.5, new Date().toISOString());

      mockTencentPePbFailure();
      mockSinaFailure();
      const result = await fetchPePbWithFallback('600519', db);
      expect(result.source).toBe('cache');
    });

    it('should fallback to AI estimate when all sources fail and no cache', async () => {
      mockTencentPePbFailure();
      mockSinaFailure();
      const result = await fetchPePbWithFallback('600519', db);
      expect(result.source).toBe('ai_estimate');
    });
  });

  describe('saveValuationToDb / getValuationFromDb', () => {
    it('should save and retrieve valuation data', () => {
      const data = {
        stockCode: '600519',
        peValue: 25.5,
        pbValue: 8.2,
        pePercentile: 45.5,
        pbPercentile: 60.2,
        peZone: 'fair' as const,
        pbZone: 'fair' as const,
        dataYears: 10,
        source: 'tencent' as const,
        updatedAt: new Date().toISOString(),
      };

      saveValuationToDb(data, db);
      const retrieved = getValuationFromDb('600519', db);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.stockCode).toBe('600519');
      expect(retrieved!.peValue).toBe(25.5);
      expect(retrieved!.pbValue).toBe(8.2);
      expect(retrieved!.pePercentile).toBe(45.5);
      expect(retrieved!.pbPercentile).toBe(60.2);
      expect(retrieved!.peZone).toBe('fair');
      expect(retrieved!.pbZone).toBe('fair');
      expect(retrieved!.dataYears).toBe(10);
      expect(retrieved!.source).toBe('tencent');
    });

    it('should return null for non-existent stock', () => {
      expect(getValuationFromDb('999999', db)).toBeNull();
    });

    it('should upsert on duplicate stock_code', () => {
      const data1 = {
        stockCode: '600519',
        peValue: 25.5,
        pbValue: 8.2,
        pePercentile: 45.5,
        pbPercentile: 60.2,
        peZone: 'fair' as const,
        pbZone: 'fair' as const,
        dataYears: 10,
        source: 'tencent' as const,
        updatedAt: new Date().toISOString(),
      };
      saveValuationToDb(data1, db);

      const data2 = { ...data1, peValue: 30.0, pePercentile: 70.0, peZone: 'high' as const };
      saveValuationToDb(data2, db);

      const retrieved = getValuationFromDb('600519', db);
      expect(retrieved!.peValue).toBe(30.0);
      expect(retrieved!.peZone).toBe('high');
    });
  });

  describe('clearValuationCache', () => {
    it('removes all valuation cache rows', () => {
      const data = {
        stockCode: '600519',
        peValue: 25.5,
        pbValue: 8.2,
        pePercentile: 45.5,
        pbPercentile: 60.2,
        peZone: 'fair' as const,
        pbZone: 'fair' as const,
        dataYears: 10,
        source: 'tencent' as const,
        updatedAt: new Date().toISOString(),
      };
      saveValuationToDb(data, db);
      expect(getValuationFromDb('600519', db)).not.toBeNull();
      const n = clearValuationCache(db);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(getValuationFromDb('600519', db)).toBeNull();
    });
  });

  describe('getStocksForValuation', () => {
    it('should return distinct stock codes from positions', () => {
      const userId = seedUser(db);
      seedPosition(db, userId, '600519', '贵州茅台');
      seedPosition(db, userId, '000858', '五粮液');

      const stocks = getStocksForValuation(db);
      expect(stocks).toContain('600519');
      expect(stocks).toContain('000858');
      expect(stocks).toHaveLength(2);
    });

    it('should return empty array when no positions', () => {
      expect(getStocksForValuation(db)).toEqual([]);
    });
  });

  describe('computeValuation', () => {
    it('should compute valuation with historical data', async () => {
      seedHistoricalPrices(db, '600519', 2500, 2015); // ~7 years of data
      mockTencentPePbSuccess(25.5, 8.2, 1800);
      mockEastMoneyCpdEmpty();

      const result = await computeValuation('600519', db);
      expect(result.stockCode).toBe('600519');
      expect(result.peValue).toBe(25.5);
      expect(result.pbValue).toBe(8.2);
      expect(result.source).toBe('tencent');
      expect(result.pePercentile).toBeGreaterThanOrEqual(0);
      expect(result.pePercentile).toBeLessThanOrEqual(100);
      expect(result.pbPercentile).toBeGreaterThanOrEqual(0);
      expect(result.pbPercentile).toBeLessThanOrEqual(100);
      expect(['low', 'fair', 'high']).toContain(result.peZone);
      expect(['low', 'fair', 'high']).toContain(result.pbZone);
      expect(result.dataYears).toBeGreaterThan(0);
    });

    it('should handle stock with no historical data', async () => {
      mockTencentPePbSuccess(25.5, 8.2, 1800);

      const result = await computeValuation('600519', db);
      expect(result.pePercentile).toBe(50); // default when no history
      expect(result.dataYears).toBe(0);
    });
  });

  describe('batchUpdateValuations', () => {
    it('should batch update all user positions', async () => {
      const userId = seedUser(db);
      seedPosition(db, userId, '600519', '贵州茅台');
      seedPosition(db, userId, '000858', '五粮液');
      seedHistoricalPrices(db, '600519', 500);
      seedHistoricalPrices(db, '000858', 500);

      // Mock Tencent for both stocks
      mockTencentPePbSuccess(25.5, 8.2, 1800);
      mockEastMoneyCpdEmpty();
      mockTencentPePbSuccess(20.0, 5.0, 150);
      mockEastMoneyCpdEmpty();

      const result = await batchUpdateValuations(db, 0); // 0ms delay for test speed
      expect(result.total).toBe(2);
      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);

      // Verify data was saved
      expect(getValuationFromDb('600519', db)).not.toBeNull();
      expect(getValuationFromDb('000858', db)).not.toBeNull();
    });

    it('should return zeros when no positions exist', async () => {
      const result = await batchUpdateValuations(db, 0);
      expect(result).toEqual({ total: 0, success: 0, failed: 0 });
    });

    it('should count failures without stopping batch', async () => {
      const userId = seedUser(db);
      seedPosition(db, userId, '600519', '贵州茅台');
      seedPosition(db, userId, '000858', '五粮液');

      // First stock succeeds, second fails all sources
      mockTencentPePbSuccess(25.5, 8.2, 1800);
      mockEastMoneyCpdEmpty();
      mockTencentPePbFailure(); // 000858 tencent fails
      mockSinaFailure(); // 000858 sina fails
      mockEastMoneyCpdEmpty();

      const result = await batchUpdateValuations(db, 0);
      expect(result.total).toBe(2);
      // First succeeds, second falls through to AI estimate which succeeds
      expect(result.success).toBe(2);
    });
  });

  describe('getValuation', () => {
    it('should return cached data if from today', async () => {
      const data = {
        stockCode: '600519',
        peValue: 25.5,
        pbValue: 8.2,
        pePercentile: 45.5,
        pbPercentile: 60.2,
        peZone: 'fair' as const,
        pbZone: 'fair' as const,
        dataYears: 10,
        source: 'tencent' as const,
        updatedAt: new Date().toISOString(),
      };
      saveValuationToDb(data, db);

      const result = await getValuation('600519', db);
      expect(result.peValue).toBe(25.5);
      // Should not have made any axios calls (used cache)
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should recompute if cache is stale', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const data = {
        stockCode: '600519',
        peValue: 25.5,
        pbValue: 8.2,
        pePercentile: 45.5,
        pbPercentile: 60.2,
        peZone: 'fair' as const,
        pbZone: 'fair' as const,
        dataYears: 10,
        source: 'tencent' as const,
        updatedAt: yesterday.toISOString(),
      };
      saveValuationToDb(data, db);

      mockTencentPePbSuccess(30.0, 9.0, 2000);
      const result = await getValuation('600519', db);
      expect(result.peValue).toBe(30.0);
    });
  });
});
