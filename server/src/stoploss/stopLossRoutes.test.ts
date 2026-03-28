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
import stopLossRoutes from './stopLossRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/stoploss', stopLossRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123' });
  return res.body.token;
}

function seedPosition(db: Database.Database, userId: number, overrides: Record<string, unknown> = {}): number {
  const defaults = {
    stock_code: '600000',
    stock_name: '浦发银行',
    position_type: 'holding',
    cost_price: 10.5,
    shares: 1000,
    buy_date: '2024-06-01',
  };
  const data = { ...defaults, ...overrides };
  const result = db.prepare(
    `INSERT INTO positions (user_id, stock_code, stock_name, position_type, cost_price, shares, buy_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, data.stock_code, data.stock_name, data.position_type, data.cost_price, data.shares, data.buy_date);
  return Number(result.lastInsertRowid);
}

function seedMarketCache(db: Database.Database, stockCode: string, price: number): void {
  db.prepare(
    `INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, updated_at)
     VALUES (?, ?, ?, 0, datetime('now'))`
  ).run(stockCode, '测试股票', price);
}

describe('Stop Loss Routes', () => {
  let app: express.Express;
  let token: string;
  let userId: number;

  beforeEach(async () => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');
    initializeDatabase(testDb);
    app = createApp();
    token = await registerAndGetToken(app);
    const user = testDb.prepare('SELECT id FROM users LIMIT 1').get() as { id: number };
    userId = user.id;
  });

  afterEach(() => {
    testDb.close();
    clearTokenBlacklist();
  });

  describe('PUT /api/stoploss/set/:id', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .put('/api/stoploss/set/1')
        .send({ stopLossPrice: 9.0 });
      expect(res.status).toBe(401);
    });

    it('should set stop loss price for a position', async () => {
      const posId = seedPosition(testDb, userId);

      const res = await request(app)
        .put(`/api/stoploss/set/${posId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stopLossPrice: 9.0 });

      expect(res.status).toBe(200);
      expect(res.body.position).toBeDefined();
      expect(res.body.position.stop_loss_price).toBe(9.0);
    });

    it('should return 400 for invalid stop loss price', async () => {
      const posId = seedPosition(testDb, userId);

      const res = await request(app)
        .put(`/api/stoploss/set/${posId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stopLossPrice: -5 });

      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent position', async () => {
      const res = await request(app)
        .put('/api/stoploss/set/9999')
        .set('Authorization', `Bearer ${token}`)
        .send({ stopLossPrice: 9.0 });

      expect(res.status).toBe(404);
    });

    it('should not allow setting stop loss on another user position', async () => {
      // Create another user
      const res2 = await request(app)
        .post('/api/auth/register')
        .send({ username: 'otheruser', password: 'pass456' });
      const otherToken = res2.body.token;
      const otherUser = testDb.prepare("SELECT id FROM users WHERE username = 'otheruser'").get() as { id: number };

      const posId = seedPosition(testDb, otherUser.id);

      const res = await request(app)
        .put(`/api/stoploss/set/${posId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stopLossPrice: 9.0 });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/stoploss/check', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/stoploss/check');
      expect(res.status).toBe(401);
    });

    it('should return empty alerts when no stop loss set', async () => {
      seedPosition(testDb, userId);

      const res = await request(app)
        .get('/api/stoploss/check')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.alerts).toEqual([]);
    });

    it('should return triggered alert when price <= stop loss', async () => {
      const posId = seedPosition(testDb, userId);
      testDb.prepare('UPDATE positions SET stop_loss_price = ? WHERE id = ?').run(10.0, posId);
      seedMarketCache(testDb, '600000', 9.5);

      const res = await request(app)
        .get('/api/stoploss/check')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.alerts).toHaveLength(1);
      expect(res.body.alerts[0].triggered).toBe(true);
      expect(res.body.alerts[0].stopLossPrice).toBe(10.0);
      expect(res.body.alerts[0].currentPrice).toBe(9.5);
    });

    it('should return non-triggered alert when price > stop loss', async () => {
      const posId = seedPosition(testDb, userId);
      testDb.prepare('UPDATE positions SET stop_loss_price = ? WHERE id = ?').run(8.0, posId);
      seedMarketCache(testDb, '600000', 10.5);

      const res = await request(app)
        .get('/api/stoploss/check')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.alerts).toHaveLength(1);
      expect(res.body.alerts[0].triggered).toBe(false);
    });
  });
});
