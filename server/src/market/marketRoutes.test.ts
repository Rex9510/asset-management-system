import request from 'supertest';
import Database from 'better-sqlite3';
import express from 'express';
import http from 'http';
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
    .send({ username, password: 'pass123', agreedTerms: true });
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

  describe('GET /api/market/sse', () => {
    function addPosition(userId: number, stockCode: string, stockName: string): void {
      const now = new Date().toISOString();
      testDb
        .prepare(
          `INSERT INTO positions (user_id, stock_code, stock_name, cost_price, shares, buy_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(userId, stockCode, stockName, 10.0, 100, '2024-01-01', now, now);
    }

    function getUserId(): number {
      const row = testDb.prepare('SELECT id FROM users WHERE username = ?').get('testuser') as { id: number };
      return row.id;
    }

    /**
     * Helper to make an SSE request and collect the first event.
     * Returns { headers, body } where body is the raw SSE text of the first event.
     */
    function collectFirstSSEEvent(
      testApp: express.Express,
      authToken: string
    ): Promise<{ headers: Record<string, string>; body: string }> {
      return new Promise((resolve, reject) => {
        const server = testApp.listen(0, () => {
          const addr = server.address() as { port: number };
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port: addr.port,
              path: '/api/market/sse',
              headers: { Authorization: `Bearer ${authToken}` },
            },
            (res) => {
              let data = '';
              const headers: Record<string, string> = {};
              for (const [key, val] of Object.entries(res.headers)) {
                if (typeof val === 'string') headers[key] = val;
              }
              res.on('data', (chunk: Buffer) => {
                data += chunk.toString();
                // We got data, check if we have a complete event (ends with \n\n)
                if (data.includes('\n\n')) {
                  res.destroy();
                  req.destroy();
                  server.close(() => resolve({ headers, body: data }));
                }
              });
              res.on('error', () => {
                server.close(() => resolve({ headers, body: data }));
              });
            }
          );
          req.on('error', (err) => {
            server.close(() => reject(err));
          });
          req.end();
        });
      });
    }

    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/market/sse');
      expect(res.status).toBe(401);
    });

    it('should set correct SSE headers', async () => {
      const { headers } = await collectFirstSSEEvent(app, token);
      expect(headers['content-type']).toContain('text/event-stream');
      expect(headers['cache-control']).toBe('no-cache');
      expect(headers['connection']).toBe('keep-alive');
    });

    it('should push empty quotes when user has no positions', async () => {
      const { body } = await collectFirstSSEEvent(app, token);
      expect(body).toContain('event: quotes');
      expect(body).toContain('"quotes":[]');
    });

    it('should push quotes for user positions', async () => {
      const userId = getUserId();
      addPosition(userId, '600000', '浦发银行');

      mockedGetQuote.mockResolvedValue({
        stockCode: '600000',
        stockName: '浦发银行',
        price: 11.58,
        changePercent: 2.5,
        volume: 50000000,
        timestamp: '2024-01-15T10:00:00.000Z',
      });

      const { body } = await collectFirstSSEEvent(app, token);
      expect(body).toContain('event: quotes');
      expect(body).toContain('600000');
      expect(body).toContain('浦发银行');
      expect(mockedGetQuote).toHaveBeenCalledWith('600000');
    });

    it('should push quotes for multiple positions with distinct stock codes', async () => {
      const userId = getUserId();
      addPosition(userId, '600000', '浦发银行');
      addPosition(userId, '000001', '平安银行');

      mockedGetQuote.mockImplementation(async (code: string) => ({
        stockCode: code,
        stockName: code === '600000' ? '浦发银行' : '平安银行',
        price: 11.58,
        changePercent: 2.5,
        volume: 50000000,
        timestamp: '2024-01-15T10:00:00.000Z',
      }));

      const { body } = await collectFirstSSEEvent(app, token);
      expect(body).toContain('600000');
      expect(body).toContain('000001');
      expect(mockedGetQuote).toHaveBeenCalledTimes(2);
    });

    it('should skip individual stock failures and still push other quotes', async () => {
      const userId = getUserId();
      addPosition(userId, '600000', '浦发银行');
      addPosition(userId, '000001', '平安银行');

      mockedGetQuote.mockImplementation(async (code: string) => {
        if (code === '600000') throw new Error('source unavailable');
        return {
          stockCode: code,
          stockName: '平安银行',
          price: 15.0,
          changePercent: 1.0,
          volume: 30000000,
          timestamp: '2024-01-15T10:00:00.000Z',
        };
      });

      const { body } = await collectFirstSSEEvent(app, token);
      expect(body).toContain('event: quotes');
      expect(body).toContain('000001');
      const dataMatch = body.match(/data: (.+)/);
      expect(dataMatch).toBeTruthy();
      const parsed = JSON.parse(dataMatch![1]);
      expect(parsed.quotes).toHaveLength(1);
      expect(parsed.quotes[0].stockCode).toBe('000001');
    });
  });
});
