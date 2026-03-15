import Database from 'better-sqlite3';
import axios from 'axios';
import { initializeDatabase } from '../db/init';
import {
  getNews,
  fetchFromEastMoney,
  fetchFromSina,
  NewsItem,
} from './newsService';
import { AppError } from '../errors/AppError';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db);
  return db;
}

function mockEastMoneyNewsSuccess() {
  mockedAxios.get.mockResolvedValueOnce({
    data: `callback(${JSON.stringify({
      Data: {
        List: [
          {
            Title: '浦发银行发布年报',
            Content: '<p>浦发银行2024年年报显示营收增长</p>',
            MediaName: '东方财富网',
            Date: '2024-01-15T10:00:00',
            Url: 'https://finance.eastmoney.com/news/1',
          },
          {
            Title: '银行板块走强',
            Content: '<p>银行板块今日集体走强</p>',
            MediaName: '东方财富网',
            Date: '2024-01-15T09:00:00',
            Url: 'https://finance.eastmoney.com/news/2',
          },
        ],
      },
    })})`,
  });
}

function mockSinaNewsSuccess() {
  mockedAxios.get.mockResolvedValueOnce({
    data: {
      result: {
        data: [
          {
            title: '浦发银行业绩预告',
            intro: '浦发银行发布业绩预告，预计净利润增长',
            media_name: '新浪财经',
            ctime: String(Math.floor(new Date('2024-01-15T10:00:00').getTime() / 1000)),
            url: 'https://finance.sina.com.cn/news/1',
          },
        ],
      },
    },
  });
}

function mockSourceFailure() {
  mockedAxios.get.mockRejectedValueOnce(new Error('Network timeout'));
}

describe('newsService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    jest.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  describe('fetchFromEastMoney', () => {
    it('should parse East Money JSONP response correctly', async () => {
      mockEastMoneyNewsSuccess();
      const items = await fetchFromEastMoney('600000');
      expect(items).toHaveLength(2);
      expect(items[0].title).toBe('浦发银行发布年报');
      expect(items[0].summary).not.toContain('<p>');
      expect(items[0].source).toBe('东方财富网');
      expect(items[0].url).toContain('eastmoney.com');
    });

    it('should throw on invalid response', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: 'invalid data' });
      await expect(fetchFromEastMoney('600000')).rejects.toThrow();
    });
  });

  describe('fetchFromSina', () => {
    it('should parse Sina response correctly', async () => {
      mockSinaNewsSuccess();
      const items = await fetchFromSina('600000');
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('浦发银行业绩预告');
      expect(items[0].source).toBe('新浪财经');
    });

    it('should throw on empty data', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { result: { data: [] } } });
      await expect(fetchFromSina('600000')).rejects.toThrow();
    });
  });

  describe('getNews - primary source success', () => {
    it('should return news from East Money (primary)', async () => {
      mockEastMoneyNewsSuccess();
      const news = await getNews('600000', 10, db);
      expect(news).toHaveLength(2);
      expect(news[0].title).toBe('浦发银行发布年报');
    });
  });

  describe('getNews - failover to Sina', () => {
    it('should failover to Sina when East Money fails', async () => {
      mockSourceFailure(); // East Money fails
      mockSinaNewsSuccess(); // Sina succeeds
      const news = await getNews('600000', 10, db);
      expect(news).toHaveLength(1);
      expect(news[0].source).toBe('新浪财经');
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('getNews - all sources fail returns empty array', () => {
    it('should return empty array when all sources fail', async () => {
      mockSourceFailure(); // East Money fails
      mockSourceFailure(); // Sina fails
      const news = await getNews('600000', 10, db);
      expect(news).toEqual([]);
    });

    it('should never throw when all sources fail', async () => {
      mockSourceFailure();
      mockSourceFailure();
      await expect(getNews('600000', 10, db)).resolves.toEqual([]);
    });
  });

  describe('getNews - cache behavior', () => {
    it('should return cached data within 30 minutes', async () => {
      // First call populates cache
      mockEastMoneyNewsSuccess();
      const first = await getNews('600000', 10, db);
      expect(first).toHaveLength(2);

      jest.clearAllMocks();

      // Second call should use cache (no HTTP calls)
      const second = await getNews('600000', 10, db);
      expect(second).toHaveLength(2);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should refetch after cache expires', async () => {
      // Populate cache with old fetched_at
      const oldTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
      db.prepare(
        `INSERT INTO news_cache (stock_code, title, summary, source, published_at, url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('600000', 'Old News', 'Old summary', 'Old Source', '2024-01-01T00:00:00', '', oldTime);

      // Should fetch fresh data since cache is expired
      mockEastMoneyNewsSuccess();
      const news = await getNews('600000', 10, db);
      expect(news).toHaveLength(2);
      expect(news[0].title).toBe('浦发银行发布年报');
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getNews - invalid stock code', () => {
    it('should throw for invalid stock codes', async () => {
      await expect(getNews('999999', 10, db)).rejects.toThrow(AppError);
      await expect(getNews('abc', 10, db)).rejects.toThrow(AppError);
    });
  });

  describe('getNews - limit parameter', () => {
    it('should respect the limit parameter', async () => {
      mockEastMoneyNewsSuccess(); // returns 2 items
      const news = await getNews('600000', 1, db);
      expect(news).toHaveLength(1);
    });
  });
});
