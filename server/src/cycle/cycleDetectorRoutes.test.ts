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

// Mock fetchAndSaveStockHistory to avoid network calls in tests
jest.mock('../market/historyService', () => ({
  fetchAndSaveStockHistory: jest.fn().mockResolvedValue(0),
}));

import authRoutes from '../auth/authRoutes';
import cycleDetectorRoutes from './cycleDetectorRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/cycle', cycleDetectorRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123', agreedTerms: true });
  return res.body.token;
}

function seedMonitor(db: Database.Database, userId: number): number {
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO cycle_monitors (user_id, stock_code, stock_name, cycle_length, current_phase, status, description, bottom_signals, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, '600519', '贵州茅台', '约6年', '高位区域', 'high', '周期节奏约6年，当前价格处于近3年85%分位，处于高位区域', '[]', now);
  return Number(info.lastInsertRowid);
}

describe('Cycle Detector Routes', () => {
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

  describe('GET /api/cycle/monitors', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/cycle/monitors');
      expect(res.status).toBe(401);
    });

    it('should return empty monitors list', async () => {
      const res = await request(app)
        .get('/api/cycle/monitors')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.monitors).toEqual([]);
    });

    it('should return seeded monitors', async () => {
      // Get user id from token
      const userId = testDb.prepare('SELECT id FROM users WHERE username = ?').get('testuser') as { id: number };
      seedMonitor(testDb, userId.id);

      const res = await request(app)
        .get('/api/cycle/monitors')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.monitors).toHaveLength(1);
      expect(res.body.monitors[0].stockCode).toBe('600519');
      expect(res.body.monitors[0].stockName).toBe('贵州茅台');
      expect(res.body.monitors[0].status).toBe('high');
      expect(res.body.monitors[0].cycleLength).toBe('约6年');
      expect(res.body.monitors[0].description).toContain('高位区域');
    });
  });

  describe('POST /api/cycle/monitors', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/api/cycle/monitors')
        .send({ stockCode: '600519' });
      expect(res.status).toBe(401);
    });

    it('should return 400 without stockCode', async () => {
      const res = await request(app)
        .post('/api/cycle/monitors')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('请提供股票代码');
    });

    it('should add a monitor and return 201', async () => {
      const res = await request(app)
        .post('/api/cycle/monitors')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600519' });
      expect(res.status).toBe(201);
      expect(res.body.stockCode).toBe('600519');
      expect(res.body.status).toBeDefined();
      expect(res.body.id).toBeDefined();
    });

    it('should persist optional stockName from body (e.g. ETF Chinese name)', async () => {
      const res = await request(app)
        .post('/api/cycle/monitors')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '159757', stockName: '电池ETF' });
      expect(res.status).toBe(201);
      expect(res.body.stockCode).toBe('159757');
      expect(res.body.stockName).toBe('电池ETF');
    });

    it('should return existing monitor if already added', async () => {
      const res1 = await request(app)
        .post('/api/cycle/monitors')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600519' });
      const res2 = await request(app)
        .post('/api/cycle/monitors')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600519' });
      expect(res2.status).toBe(201);
      expect(res2.body.id).toBe(res1.body.id);
    });
  });

  describe('DELETE /api/cycle/monitors/:id', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).delete('/api/cycle/monitors/1');
      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent monitor', async () => {
      const res = await request(app)
        .delete('/api/cycle/monitors/999')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .delete('/api/cycle/monitors/abc')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('should delete an existing monitor', async () => {
      const userId = testDb.prepare('SELECT id FROM users WHERE username = ?').get('testuser') as { id: number };
      const monitorId = seedMonitor(testDb, userId.id);

      const res = await request(app)
        .delete(`/api/cycle/monitors/${monitorId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify deleted
      const listRes = await request(app)
        .get('/api/cycle/monitors')
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.body.monitors).toHaveLength(0);
    });

    it('should not delete another user\'s monitor', async () => {
      // Create another user
      const res2 = await request(app)
        .post('/api/auth/register')
        .send({ username: 'otheruser', password: 'pass456', agreedTerms: true });
      const otherUserId = testDb.prepare('SELECT id FROM users WHERE username = ?').get('otheruser') as { id: number };
      const monitorId = seedMonitor(testDb, otherUserId.id);

      const res = await request(app)
        .delete(`/api/cycle/monitors/${monitorId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });
});
