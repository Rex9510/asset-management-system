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
import operationLogRoutes from './operationLogRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/oplog', operationLogRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123' });
  return res.body.token;
}

function insertLogWithDate(
  db: Database.Database,
  userId: number,
  stockCode: string,
  stockName: string,
  price: number,
  daysAgo: number
): number {
  const result = db.prepare(
    `INSERT INTO operation_logs (user_id, operation_type, stock_code, stock_name, price, shares, created_at)
     VALUES (?, 'create', ?, ?, ?, 100, datetime('now', '-${daysAgo} days'))`
  ).run(userId, stockCode, stockName, price);
  return result.lastInsertRowid as number;
}

function insertMarketCache(db: Database.Database, stockCode: string, price: number): void {
  db.prepare(
    `INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at)
     VALUES (?, ?, ?, 0, 1000000, datetime('now'))`
  ).run(stockCode, stockCode, price);
}

describe('Operation Log Routes', () => {
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

  describe('GET /api/oplog', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/oplog');
      expect(res.status).toBe(401);
    });

    it('should return paginated logs', async () => {
      // Insert 3 logs
      for (let i = 1; i <= 3; i++) {
        insertLogWithDate(testDb, 1, '600000', '浦发银行', 10 + i, i);
      }

      const res = await request(app)
        .get('/api/oplog?page=1&limit=2')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.logs).toHaveLength(2);
      // Most recent first
      expect(res.body.logs[0].price).toBe(11);
      expect(res.body.logs[1].price).toBe(12);
    });

    it('should return empty when no logs', async () => {
      const res = await request(app)
        .get('/api/oplog')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.logs).toHaveLength(0);
    });
  });

  describe('GET /api/oplog/review', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/oplog/review');
      expect(res.status).toBe(401);
    });

    it('should return reviews', async () => {
      // Insert a log old enough for 7d review
      insertLogWithDate(testDb, 1, '600000', '浦发银行', 10.0, 8);
      insertMarketCache(testDb, '600000', 11.0);

      // Generate reviews
      const { generateReviews } = require('./operationLogService');
      generateReviews(testDb);

      const res = await request(app)
        .get('/api/oplog/review')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].review_7d).toContain('操作后7天');
    });

    it('should return empty when no reviews exist', async () => {
      // Insert a recent log (no review yet)
      insertLogWithDate(testDb, 1, '600000', '浦发银行', 10.0, 2);

      const res = await request(app)
        .get('/api/oplog/review')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });
});
