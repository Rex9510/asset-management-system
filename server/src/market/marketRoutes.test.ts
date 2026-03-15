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

// Mock the marketDataService's getQuote
jest.mock('./marketDataService', () => {
  const original = jest.requireActual('./marketDataService');
  return {
    ...original,
    getQuote: jest.fn(),
  };
});

import { getQuote } from './marketDataService';
import authRoutes from '../auth/authRoutes';
import marketRoutes from './marketRoutes';

const mockedGetQuote = getQuote as jest.MockedFunction<typeof getQuote>;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/market', marketRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express, username = 'testuser'): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'pass123' });
  return res.body.token;
}

describe('Market Routes', () => {
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

  describe('GET /api/market/quote/:code', () => {
    it('should return quote data for valid stock code', async () => {
      mockedGetQuote.mockResolvedValueOnce({
        stockCode: '600000',
        stockName: '浦发银行',
        price: 11.58,
        changePercent: 2.5,
        volume: 50000000,
        timestamp: '2024-01-15T10:00:00.000Z',
      });

      const res = await request(app)
        .get('/api/market/quote/600000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.quote.stockCode).toBe('600000');
      expect(res.body.quote.price).toBe(11.58);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/market/quote/600000');
      expect(res.status).toBe(401);
    });

    it('should return error for invalid stock code', async () => {
      const { AppError } = require('../errors/AppError');
      mockedGetQuote.mockRejectedValueOnce(
        new AppError(400, 'BAD_REQUEST', '股票代码无效，请输入正确的A股代码（6位数字）')
      );

      const res = await request(app)
        .get('/api/market/quote/999999')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it('should return delayed data when all sources fail but cache exists', async () => {
      mockedGetQuote.mockResolvedValueOnce({
        stockCode: '600000',
        stockName: '浦发银行',
        price: 11.50,
        changePercent: 1.0,
        volume: 40000000,
        timestamp: '2024-01-15T09:00:00.000Z',
        delayed: true,
      });

      const res = await request(app)
        .get('/api/market/quote/600000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.quote.delayed).toBe(true);
    });
  });
});
