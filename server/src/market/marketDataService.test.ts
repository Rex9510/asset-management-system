import Database from 'better-sqlite3';
import axios from 'axios';
import { initializeDatabase } from '../db/init';
import {
  getQuote,
  resetSourceState,
  getCurrentSource,
  getMarketPrefix,
  fetchFromEastMoney,
  fetchFromSina,
  fetchFromTencent,
} from './marketDataService';
import { AppError } from '../errors/AppError';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db);
  return db;
}

// Mock responses for each data source
function mockEastMoneySuccess(stockCode = '600000', name = '浦发银行') {
  mockedAxios.get.mockResolvedValueOnce({
    data: {
      data: {
        f57: stockCode,
        f58: name,
        f43: 1158,       // price in cents: 11.58
        f170: 250,        // changePercent in basis points: 2.50%
        f47: 50000000,
        f44: 1165,
        f45: 1150,
        f46: 1155,
      },
    },
  });
}

function mockSinaSuccess(stockCode = '600000', name = '浦发银行') {
  const prefix = getMarketPrefix(stockCode);
  mockedAxios.get.mockResolvedValueOnce({
    data: `var hq_str_${prefix}${stockCode}="${name},11.57,11.50,11.58,11.65,11.48,11.57,11.58,50000000,57800000,100,11.57,200,11.56,300,11.55,400,11.54,500,11.53,100,11.58,200,11.59,300,11.60,400,11.61,500,11.62,2024-01-15,15:00:00,00,";`,
  });
}

function mockTencentSuccess(stockCode = '600000', name = '浦发银行') {
  // Build a string with at least 45 tilde-separated fields
  const parts = new Array(50).fill('0');
  parts[1] = name;
  parts[3] = '11.58';
  parts[6] = '50000000';
  parts[32] = '2.50';
  mockedAxios.get.mockResolvedValueOnce({
    data: `v_sh${stockCode}="${parts.join('~')}";`,
  });
}

function mockSourceFailure() {
  mockedAxios.get.mockRejectedValueOnce(new Error('Network timeout'));
}

describe('marketDataService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    resetSourceState();
    jest.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  describe('getMarketPrefix', () => {
    it('should return sh for Shanghai codes (6xxxxx)', () => {
      expect(getMarketPrefix('600000')).toBe('sh');
      expect(getMarketPrefix('601318')).toBe('sh');
      expect(getMarketPrefix('688981')).toBe('sh');
    });

    it('should return sz for Shenzhen codes (0xxxxx/3xxxxx)', () => {
      expect(getMarketPrefix('000001')).toBe('sz');
      expect(getMarketPrefix('300750')).toBe('sz');
      expect(getMarketPrefix('002594')).toBe('sz');
    });
  });

  describe('getQuote - primary source success', () => {
    it('should return quote from East Money (primary source)', async () => {
      mockEastMoneySuccess();
      const quote = await getQuote('600000', db);
      expect(quote.stockCode).toBe('600000');
      expect(quote.stockName).toBe('浦发银行');
      expect(quote.price).toBe(11.58);
      expect(quote.changePercent).toBe(2.5);
      expect(quote.delayed).toBeUndefined();
      expect(getCurrentSource()).toBe('eastmoney');
    });
  });

  describe('getQuote - failover from primary to secondary', () => {
    it('should failover to Sina when East Money fails', async () => {
      mockSourceFailure(); // eastmoney fails
      mockSinaSuccess();   // sina succeeds
      const quote = await getQuote('600000', db);
      expect(quote.stockCode).toBe('600000');
      expect(quote.price).toBe(11.58);
      expect(quote.delayed).toBeUndefined();
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('getQuote - failover from secondary to tertiary', () => {
    it('should failover to Tencent when East Money and Sina fail', async () => {
      mockSourceFailure(); // eastmoney fails
      mockSourceFailure(); // sina fails
      mockTencentSuccess(); // tencent succeeds
      const quote = await getQuote('600000', db);
      expect(quote.stockCode).toBe('600000');
      expect(quote.price).toBe(11.58);
      expect(quote.delayed).toBeUndefined();
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });
  });

  describe('getQuote - cache fallback when all sources fail', () => {
    it('should return cached data with delayed flag when all sources fail', async () => {
      // First, populate cache with a successful call
      mockEastMoneySuccess();
      await getQuote('600000', db);
      resetSourceState();
      jest.clearAllMocks();

      // Now all sources fail
      mockSourceFailure(); // eastmoney
      mockSourceFailure(); // sina
      mockSourceFailure(); // tencent
      const quote = await getQuote('600000', db);
      expect(quote.stockCode).toBe('600000');
      expect(quote.delayed).toBe(true);
    });

    it('should throw when all sources fail and no cache exists', async () => {
      mockSourceFailure();
      mockSourceFailure();
      mockSourceFailure();
      await expect(getQuote('600000', db)).rejects.toThrow(AppError);
    });
  });

  describe('getQuote - switch back to primary after 3 consecutive successes', () => {
    it('should switch back to primary after 3 consecutive successes on backup', async () => {
      // First call: primary fails, secondary succeeds
      mockSourceFailure(); // eastmoney fails
      mockSinaSuccess();   // sina succeeds (1st success)
      await getQuote('600000', db);
      expect(getCurrentSource()).toBe('sina');

      // 2nd success on sina
      jest.clearAllMocks();
      mockSinaSuccess();
      await getQuote('600000', db);
      expect(getCurrentSource()).toBe('sina');

      // 3rd success on sina -> should switch back to primary
      jest.clearAllMocks();
      mockSinaSuccess();
      await getQuote('600000', db);
      expect(getCurrentSource()).toBe('eastmoney');
    });
  });

  describe('getQuote - invalid stock code rejection', () => {
    it('should reject invalid stock codes', async () => {
      await expect(getQuote('999999', db)).rejects.toThrow(AppError);
      await expect(getQuote('abc', db)).rejects.toThrow(AppError);
      await expect(getQuote('', db)).rejects.toThrow(AppError);
    });
  });
});
