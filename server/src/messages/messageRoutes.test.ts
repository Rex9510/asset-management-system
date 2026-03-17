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
import messageRoutes from './messageRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/messages', messageRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(
  app: express.Express,
  username = 'testuser'
): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'pass123' });
  return res.body.token;
}

function getUserId(db: Database.Database, username = 'testuser'): number {
  return (db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number }).id;
}

function insertMessage(
  db: Database.Database,
  userId: number,
  overrides: Partial<{
    type: string; stockCode: string; stockName: string;
    summary: string; detail: string; isRead: number; createdAt: string;
  }> = {}
): number {
  const {
    type = 'scheduled_analysis', stockCode = '600000', stockName = '浦发银行',
    summary = '测试摘要', detail = '测试详情', isRead = 0,
    createdAt = new Date().toISOString(),
  } = overrides;
  const result = db.prepare(
    'INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, type, stockCode, stockName, summary, detail, isRead, createdAt);
  return result.lastInsertRowid as number;
}

describe('Message Routes', () => {
  let app: express.Express;
  let token: string;
  let userId: number;

  beforeEach(async () => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = OFF');
    initializeDatabase(testDb);
    app = createApp();
    token = await registerAndGetToken(app);
    userId = getUserId(testDb);
  });

  afterEach(() => {
    testDb.close();
    clearTokenBlacklist();
  });

  describe('GET /api/messages', () => {
    it('should return empty list when no messages', async () => {
      const res = await request(app)
        .get('/api/messages')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.messages).toEqual([]);
      expect(res.body.total).toBe(0);
      expect(res.body.hasMore).toBe(false);
    });

    it('should return messages with pagination', async () => {
      for (let i = 0; i < 3; i++) {
        insertMessage(testDb, userId, { summary: `消息${i}` });
      }

      const res = await request(app)
        .get('/api/messages?page=1&limit=2')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.total).toBe(3);
      expect(res.body.hasMore).toBe(true);
    });

    it('should filter by type', async () => {
      insertMessage(testDb, userId, { type: 'scheduled_analysis' });
      insertMessage(testDb, userId, { type: 'volatility_alert' });

      const res = await request(app)
        .get('/api/messages?type=volatility_alert')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0].type).toBe('volatility_alert');
    });

    it('should return 400 for invalid type', async () => {
      const res = await request(app)
        .get('/api/messages?type=invalid')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/messages');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/messages/unread-count', () => {
    it('should return 0 when no messages', async () => {
      const res = await request(app)
        .get('/api/messages/unread-count')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
    });

    it('should return correct unread count', async () => {
      insertMessage(testDb, userId, { isRead: 0 });
      insertMessage(testDb, userId, { isRead: 0 });
      insertMessage(testDb, userId, { isRead: 1 });

      const res = await request(app)
        .get('/api/messages/unread-count')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/messages/unread-count');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/messages/:id', () => {
    it('should return message and mark as read', async () => {
      const msgId = insertMessage(testDb, userId, { summary: '详情测试' });

      const res = await request(app)
        .get(`/api/messages/${msgId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message.id).toBe(msgId);
      expect(res.body.message.summary).toBe('详情测试');
      expect(res.body.message.isRead).toBe(true);
    });

    it('should return 404 for non-existent message', async () => {
      const res = await request(app)
        .get('/api/messages/999')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app)
        .get('/api/messages/abc')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it('should not return other user message', async () => {
      const otherToken = await registerAndGetToken(app, 'otheruser');
      const otherUserId = getUserId(testDb, 'otheruser');
      const msgId = insertMessage(testDb, otherUserId, { summary: '别人的' });

      const res = await request(app)
        .get(`/api/messages/${msgId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/messages/1');
      expect(res.status).toBe(401);
    });
  });
});
