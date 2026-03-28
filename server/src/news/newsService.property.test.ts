import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import { getNews, NewsItem } from './newsService';

jest.mock('axios');
const axios = require('axios');

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

const validStockCode = fc.constantFrom('600000', '000001', '300750', '688001');

describe('属性测试：新闻数据结构完整性', () => {
  it('返回的新闻条目应包含 title/summary/source/publishedAt/url 字段', async () => {
    await fc.assert(
      fc.asyncProperty(validStockCode, fc.integer({ min: 1, max: 10 }), async (stockCode, limit) => {
        const db = makeDb();

        // Pre-populate cache with valid news
        const now = new Date().toISOString();
        for (let i = 0; i < limit; i++) {
          db.prepare(
            `INSERT INTO news_cache (stock_code, title, summary, source, published_at, url, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(stockCode, `新闻标题${i}`, `摘要${i}`, '东方财富', now, `https://example.com/${i}`, now);
        }

        const items = await getNews(stockCode, limit, db);
        expect(items.length).toBeLessThanOrEqual(limit);
        for (const item of items) {
          expect(item).toHaveProperty('title');
          expect(item).toHaveProperty('summary');
          expect(item).toHaveProperty('source');
          expect(item).toHaveProperty('publishedAt');
          expect(item).toHaveProperty('url');
          expect(typeof item.title).toBe('string');
          expect(typeof item.summary).toBe('string');
        }
      }),
      { numRuns: 30 }
    );
  });
});

describe('属性测试：新闻服务降级不中断分析', () => {
  it('当所有新闻源失败且无缓存时，应返回空数组而非抛出异常', async () => {
    await fc.assert(
      fc.asyncProperty(validStockCode, async (stockCode) => {
        const db = makeDb();
        axios.get.mockRejectedValue(new Error('network error'));

        const items = await getNews(stockCode, 10, db);
        expect(Array.isArray(items)).toBe(true);
        expect(items.length).toBe(0);
      }),
      { numRuns: 20 }
    );
  });
});
