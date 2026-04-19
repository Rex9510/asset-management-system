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
import sentimentRoutes from './sentimentRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/sentiment', sentimentRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123', agreedTerms: true });
  return res.body.token;
}

function seedSentimentData(db: Database.Database): void {
  db.prepare(
    `INSERT INTO sentiment_index (score, label, volume_ratio, sh_change_percent, hs300_change_percent, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(48, '中性', 1.05, 0.32, -0.15, '2024-06-01T16:30:00.000Z');
}

describe('Sentiment Routes', () => {
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

  describe('GET /api/sentiment/current', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/sentiment/current');
      expect(res.status).toBe(401);
    });

    it('should return null score when no sentiment data exists', async () => {
      const res = await request(app)
        .get('/api/sentiment/current')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.score).toBeNull();
      expect(res.body.message).toBe('暂无情绪数据');
    });

    it('should return sentiment data when seeded', async () => {
      seedSentimentData(testDb);

      const res = await request(app)
        .get('/api/sentiment/current')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.score).toBe(48);
      expect(res.body.label).toBe('中性');
      expect(res.body.emoji).toBe('😐');
      expect(res.body.components).toBeDefined();
      expect(res.body.components.volumeRatio).toBe(1.05);
      expect(res.body.components.shChangePercent).toBe(0.32);
      expect(res.body.components.hs300ChangePercent).toBe(-0.15);
      expect(res.body.updatedAt).toBeDefined();
    });
  });
});
