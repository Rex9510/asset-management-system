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
import dailyPickTrackingRoutes from './dailyPickTrackingRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/daily-pick', dailyPickTrackingRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123', agreedTerms: true });
  return res.body.token;
}

function seedTrackingData(db: Database.Database, userId: number): void {
  // Insert a daily_pick message first
  db.prepare(`
    INSERT INTO messages (id, user_id, type, stock_code, stock_name, summary, detail, is_read, created_at)
    VALUES (?, ?, 'daily_pick', '600519', '贵州茅台', '每日关注', '{}', 0, ?)
  `).run(100, userId, '2025-01-01');

  // Insert tracking records
  db.prepare(`
    INSERT INTO daily_pick_tracking
      (pick_message_id, stock_code, stock_name, pick_date, pick_price,
       tracking_days, tracked_price, return_percent, tracked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(100, '600519', '贵州茅台', '2025-01-01', 1800.0, 3, 1850.0, 2.78, '2025-01-04T16:00:00Z');

  db.prepare(`
    INSERT INTO daily_pick_tracking
      (pick_message_id, stock_code, stock_name, pick_date, pick_price,
       tracking_days, tracked_price, return_percent, tracked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(100, '600519', '贵州茅台', '2025-01-01', 1800.0, 7, 1750.0, -2.78, '2025-01-08T16:00:00Z');
}

describe('DailyPickTracking Routes', () => {
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

  describe('GET /api/daily-pick/tracking', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/daily-pick/tracking');
      expect(res.status).toBe(401);
    });

    it('should return empty trackings when no data exists', async () => {
      const res = await request(app)
        .get('/api/daily-pick/tracking')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.trackings).toEqual([]);
    });

    it('should return tracking records when seeded', async () => {
      const user = testDb.prepare('SELECT id FROM users WHERE username = ?').get('testuser') as { id: number };
      seedTrackingData(testDb, user.id);

      const res = await request(app)
        .get('/api/daily-pick/tracking')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.trackings).toHaveLength(2);

      // Sorted by tracked_at DESC, so 7-day record comes first
      const first = res.body.trackings[0];
      expect(first.stockCode).toBe('600519');
      expect(first.stockName).toBe('贵州茅台');
      expect(first.pickPrice).toBe(1800.0);
      expect(first.trackingDays).toBe(7);
      expect(first.currentPrice).toBe(1750.0);
      expect(first.returnPercent).toBe(-2.78);
      expect(first.status).toBe('loss');

      const second = res.body.trackings[1];
      expect(second.trackingDays).toBe(3);
      expect(second.currentPrice).toBe(1850.0);
      expect(second.status).toBe('profit');
    });
  });

  describe('GET /api/daily-pick/accuracy', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/daily-pick/accuracy');
      expect(res.status).toBe(401);
    });

    it('should return zero stats when no data exists', async () => {
      const res = await request(app)
        .get('/api/daily-pick/accuracy')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.totalPicks).toBe(0);
      expect(res.body.profitCount).toBe(0);
      expect(res.body.lossCount).toBe(0);
      expect(res.body.avgReturn).toBe(0);
      expect(res.body.winRate).toBe(0);
    });

    it('should return accuracy stats when seeded', async () => {
      const user = testDb.prepare('SELECT id FROM users WHERE username = ?').get('testuser') as { id: number };
      seedTrackingData(testDb, user.id);

      const res = await request(app)
        .get('/api/daily-pick/accuracy')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      // 1 unique pick, latest tracking (7-day) has return -2.78 → loss
      expect(res.body.totalPicks).toBe(1);
      expect(res.body.lossCount).toBe(1);
      expect(res.body.profitCount).toBe(0);
      expect(res.body.winRate).toBe(0);
      // avgReturn = mean of all records: (2.78 + -2.78) / 2 = 0
      expect(res.body.avgReturn).toBe(0);
    });

    it('should not include another user picks in accuracy', async () => {
      const user = testDb.prepare('SELECT id FROM users WHERE username = ?').get('testuser') as { id: number };
      seedTrackingData(testDb, user.id);

      const reg = await request(app)
        .post('/api/auth/register')
        .send({ username: 'otheraccuracy', password: 'pass123', agreedTerms: true });
      const tokenOther = reg.body.token as string;

      const res = await request(app)
        .get('/api/daily-pick/accuracy')
        .set('Authorization', `Bearer ${tokenOther}`);

      expect(res.status).toBe(200);
      expect(res.body.totalPicks).toBe(0);
    });
  });
});
