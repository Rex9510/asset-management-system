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

jest.mock('axios');

import authRoutes from '../auth/authRoutes';
import backtestRoutes from './backtestRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/backtest', backtestRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123', agreedTerms: true });
  return res.body.token;
}

function seedValuationCache(db: Database.Database, stockCode: string, pePercentile: number) {
  db.prepare(
    `INSERT OR REPLACE INTO valuation_cache (stock_code, pe_value, pb_value, pe_percentile, pb_percentile, pe_zone, pb_zone, data_years, source)
     VALUES (?, 15.0, 1.5, ?, 40, 'low', 'fair', 10, 'tencent')`
  ).run(stockCode, pePercentile);
}

function seedMarketHistory(db: Database.Database, stockCode: string, days: number) {
  const baseDate = new Date('2020-01-01');
  for (let i = 0; i < days; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    // Simulate price movement: base 10 with some variation
    const close = 10 + Math.sin(i / 30) * 3 + (i / days) * 5;
    const open = close - 0.1;
    const high = close + 0.5;
    const low = close - 0.5;
    const volume = 100000 + i * 100;
    db.prepare(
      'INSERT OR REPLACE INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(stockCode, dateStr, Math.round(open * 100) / 100, Math.round(close * 100) / 100, Math.round(high * 100) / 100, Math.round(low * 100) / 100, volume);
  }
}

describe('Backtest Routes', () => {
  let app: express.Express;
  let token: string;

  beforeEach(async () => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');
    initializeDatabase(testDb);
    app = createApp();
    token = await registerAndGetToken(app);
  });

  afterEach(() => {
    testDb.close();
    clearTokenBlacklist();
  });

  describe('POST /api/backtest/:stockCode', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).post('/api/backtest/600000');
      expect(res.status).toBe(401);
    });

    it('should return backtest result with empty data', async () => {
      const res = await request(app)
        .post('/api/backtest/600000')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.stockCode).toBe('600000');
      expect(res.body.disclaimer).toBeTruthy();
      expect(res.body.sampleWarning).toBe(true);
      expect(res.body.results).toHaveLength(4);
    });

    it('should return backtest result with seeded data', async () => {
      seedValuationCache(testDb, '600000', 25);
      seedMarketHistory(testDb, '600000', 500);

      const res = await request(app)
        .post('/api/backtest/600000')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.stockCode).toBe('600000');
      expect(res.body.currentPercentile).toBe(25);
      expect(res.body.results).toHaveLength(4);
      expect(res.body.disclaimer).toContain('以上内容仅供学习参考，不构成投资依据');

      // Each period result should have the expected fields
      for (const pr of res.body.results) {
        expect(['30d', '90d', '180d', '365d']).toContain(pr.period);
        expect(typeof pr.winRate).toBe('number');
        expect(typeof pr.avgReturn).toBe('number');
        expect(typeof pr.maxReturn).toBe('number');
        expect(typeof pr.maxLoss).toBe('number');
        expect(typeof pr.medianReturn).toBe('number');
      }
    });

    it('should set sampleWarning when few matching points', async () => {
      // With very few data points, matching points will be < 5
      seedValuationCache(testDb, '600000', 50);
      seedMarketHistory(testDb, '600000', 10);

      const res = await request(app)
        .post('/api/backtest/600000')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.sampleWarning).toBe(true);
    });

    it('should return 400 for empty stockCode param', async () => {
      const res = await request(app)
        .post('/api/backtest/%20')
        .set('Authorization', `Bearer ${token}`);
      // The route trims the stockCode; a space-only code becomes empty
      expect(res.status).toBe(400);
    });
  });
});
