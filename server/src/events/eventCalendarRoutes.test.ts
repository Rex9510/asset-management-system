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
import eventCalendarRoutes from './eventCalendarRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/events', eventCalendarRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123', agreedTerms: true });
  return res.body.token;
}

function seedEvent(db: Database.Database, overrides: Record<string, unknown> = {}): void {
  const now = new Date().toISOString();
  const defaults = {
    name: '全国两会',
    event_date: '2026-03-03',
    event_end_date: '2026-03-15',
    category: 'policy',
    related_sectors: '["基建","环保","科技"]',
    before_days: 7,
    after_days: 5,
    tip: '关注政策方向',
    is_seed: 1,
  };
  const data = { ...defaults, ...overrides };
  db.prepare(
    `INSERT INTO event_calendar (name, event_date, event_end_date, category, related_sectors, before_days, after_days, tip, is_seed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.name, data.event_date, data.event_end_date, data.category,
    data.related_sectors, data.before_days, data.after_days, data.tip,
    data.is_seed, now, now
  );
}

describe('Event Calendar Routes', () => {
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

  describe('GET /api/events', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/events');
      expect(res.status).toBe(401);
    });

    it('should return empty events array when no events exist', async () => {
      const res = await request(app)
        .get('/api/events')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.events).toEqual([]);
    });

    it('should return events with default days=7', async () => {
      // Seed an event happening today so it falls within the window
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      seedEvent(testDb, { event_date: todayStr, event_end_date: todayStr, before_days: 7, after_days: 5 });

      const res = await request(app)
        .get('/api/events')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.events.length).toBeGreaterThanOrEqual(1);
      expect(res.body.events[0].name).toBe('全国两会');
      expect(res.body.events[0].windowStatus).toBeDefined();
      expect(res.body.events[0].windowLabel).toBeDefined();
    });

    it('should accept custom days parameter', async () => {
      const res = await request(app)
        .get('/api/events?days=30')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.events)).toBe(true);
    });
  });

  describe('POST /api/events', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).post('/api/events').send({});
      expect(res.status).toBe(401);
    });

    it('should return 400 when missing required fields', async () => {
      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '测试事件' });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('缺少必填字段');
    });

    it('should create an event successfully', async () => {
      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: '测试事件',
          eventDate: '2026-06-01',
          eventEndDate: '2026-06-03',
          category: 'exhibition',
          relatedSectors: ['科技', '消费'],
          beforeDays: 5,
          afterDays: 3,
          tip: '关注科技板块',
        });
      expect(res.status).toBe(201);
      expect(res.body.event.name).toBe('测试事件');
      expect(res.body.event.category).toBe('exhibition');
      expect(res.body.event.relatedSectors).toEqual(['科技', '消费']);
      expect(res.body.event.id).toBeDefined();
    });
  });

  describe('PUT /api/events/:id', () => {
    it('should return 404 for non-existent event', async () => {
      const res = await request(app)
        .put('/api/events/9999')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '更新' });
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('事件不存在');
    });

    it('should update an existing event', async () => {
      // Create first
      const createRes = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: '原始事件',
          eventDate: '2026-06-01',
          category: 'policy',
          relatedSectors: ['基建'],
          beforeDays: 5,
          afterDays: 3,
        });
      const id = createRes.body.event.id;

      const res = await request(app)
        .put(`/api/events/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '更新后事件', tip: '新提示' });
      expect(res.status).toBe(200);
      expect(res.body.event.name).toBe('更新后事件');
      expect(res.body.event.tip).toBe('新提示');
    });
  });

  describe('DELETE /api/events/:id', () => {
    it('should return 404 for non-existent event', async () => {
      const res = await request(app)
        .delete('/api/events/9999')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('事件不存在');
    });

    it('should delete an existing event', async () => {
      const createRes = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: '待删除事件',
          eventDate: '2026-06-01',
          category: 'policy',
          relatedSectors: ['基建'],
          beforeDays: 5,
          afterDays: 3,
        });
      const id = createRes.body.event.id;

      const res = await request(app)
        .delete(`/api/events/${id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify it's gone - try to update it
      const updateRes = await request(app)
        .put(`/api/events/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'should fail' });
      expect(updateRes.status).toBe(404);
    });
  });
});