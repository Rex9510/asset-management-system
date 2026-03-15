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

import authRoutes from '../auth/authRoutes';
import indicatorRoutes from './indicatorRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/indicators', indicatorRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123' });
  return res.body.token;
}

function insertMarketHistory(db: Database.Database, stockCode: string, days: number, basePrice = 10): void {
  const stmt = db.prepare(
    `INSERT INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const startDate = new Date('2024-01-02');
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const variation = Math.sin(i * 0.3) * 2;
    const close = basePrice + variation;
    stmt.run(stockCode, dateStr, close - 0.1, close, close + 0.5, close - 0.5, 1000000);
  }
}

describe('Indicator Routes', () => {
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

  describe('GET /api/indicators/:stockCode', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/indicators/600000');
      expect(res.status).toBe(401);
    });

    it('should return 400 for invalid stock code', async () => {
      const res = await request(app)
        .get('/api/indicators/999999')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('should return 404 when no market history exists', async () => {
      const res = await request(app)
        .get('/api/indicators/600000')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('should return indicators with sufficient data', async () => {
      insertMarketHistory(testDb, '600000', 70);

      const res = await request(app)
        .get('/api/indicators/600000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.stockCode).toBe('600000');
      expect(res.body.ma).toBeDefined();
      expect(res.body.ma.ma5).not.toBeNull();
      expect(res.body.ma.ma60).not.toBeNull();
      expect(res.body.macd).toBeDefined();
      expect(res.body.kdj).toBeDefined();
      expect(res.body.rsi).toBeDefined();
      expect(res.body.signals).toBeDefined();
      expect(res.body.signals.ma.direction).toMatch(/^(bullish|neutral|bearish)$/);
      expect(res.body.signals.macd.direction).toMatch(/^(bullish|neutral|bearish)$/);
      expect(res.body.signals.kdj.direction).toMatch(/^(bullish|neutral|bearish)$/);
      expect(res.body.signals.rsi.direction).toMatch(/^(bullish|neutral|bearish)$/);
      expect(res.body.updatedAt).toBeDefined();
    });

    it('should handle partial data gracefully', async () => {
      insertMarketHistory(testDb, '600000', 10);

      const res = await request(app)
        .get('/api/indicators/600000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.ma.ma5).not.toBeNull();
      expect(res.body.ma.ma60).toBeNull(); // Not enough data
    });
  });
});
