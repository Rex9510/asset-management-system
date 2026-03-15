import request from 'supertest';
import Database from 'better-sqlite3';
import express from 'express';
import { initializeDatabase } from '../db/init';
import { errorHandler } from '../middleware/errorHandler';
import { clearTokenBlacklist } from '../auth/authService';

let testDb: Database.Database;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

jest.mock('./newsService', () => {
  const original = jest.requireActual('./newsService');
  return {
    ...original,
    getNews: jest.fn(),
  };
});

import { getNews } from './newsService';
import authRoutes from '../auth/authRoutes';
import newsRoutes from './newsRoutes';

const mockedGetNews = getNews as jest.MockedFunction<typeof getNews>;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/news', newsRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express, username = 'testuser'): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'pass123' });
  return res.body.token;
}

describe('News Routes', () => {
  let app: express.Express;
  let token: string;

  beforeEach(async () => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');
    initializeDatabase(testDb);
    app = createApp();
    token = await registerAndGetToken(app);
    jest.clearAllMocks();
  });

  afterEach(() => {
    testDb.close();
    clearTokenBlacklist();
  });

  describe('GET /api/news/:stockCode', () => {
    it('should return news for valid stock code', async () => {
      mockedGetNews.mockResolvedValueOnce([
        {
          title: '浦发银行发布年报',
          summary: '浦发银行2024年年报显示营收增长',
          source: '东方财富网',
          publishedAt: '2024-01-15T10:00:00',
          url: 'https://finance.eastmoney.com/news/1',
        },
      ]);

      const res = await request(app)
        .get('/api/news/600000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.news).toHaveLength(1);
      expect(res.body.news[0].title).toBe('浦发银行发布年报');
    });

    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/news/600000');
      expect(res.status).toBe(401);
    });

    it('should return error for invalid stock code', async () => {
      const { AppError } = require('../errors/AppError');
      mockedGetNews.mockRejectedValueOnce(
        new AppError(400, 'BAD_REQUEST', '股票代码无效，请输入正确的A股代码（6位数字）')
      );

      const res = await request(app)
        .get('/api/news/999999')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it('should return empty array when all sources fail', async () => {
      mockedGetNews.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/news/600000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.news).toEqual([]);
    });

    it('should pass limit query parameter', async () => {
      mockedGetNews.mockResolvedValueOnce([]);

      await request(app)
        .get('/api/news/600000?limit=5')
        .set('Authorization', `Bearer ${token}`);

      expect(mockedGetNews).toHaveBeenCalledWith('600000', 5);
    });

    it('should default limit to 10', async () => {
      mockedGetNews.mockResolvedValueOnce([]);

      await request(app)
        .get('/api/news/600000')
        .set('Authorization', `Bearer ${token}`);

      expect(mockedGetNews).toHaveBeenCalledWith('600000', 10);
    });
  });
});
