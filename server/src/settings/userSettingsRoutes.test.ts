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
import userSettingsRoutes from './userSettingsRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/settings', userSettingsRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123', agreedTerms: true });
  return res.body.token;
}

describe('User Settings Routes', () => {
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

  describe('GET /api/settings', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/settings');
      expect(res.status).toBe(401);
    });

    it('should return default settings', async () => {
      const res = await request(app)
        .get('/api/settings')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        aiModel: 'deepseek-v3',
        analysisFrequency: 60,
        riskPreference: 'balanced',
      });
    });
  });

  describe('PUT /api/settings', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .put('/api/settings')
        .send({ aiModel: 'claude' });
      expect(res.status).toBe(401);
    });

    it('should update settings', async () => {
      const res = await request(app)
        .put('/api/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({
          aiModel: 'claude',
          analysisFrequency: 30,
          riskPreference: 'aggressive',
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        aiModel: 'claude',
        analysisFrequency: 30,
        riskPreference: 'aggressive',
      });
    });

    it('should return 400 for invalid aiModel', async () => {
      const res = await request(app)
        .put('/api/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ aiModel: 'gpt-4' });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid analysisFrequency', async () => {
      const res = await request(app)
        .put('/api/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ analysisFrequency: 45 });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid riskPreference', async () => {
      const res = await request(app)
        .put('/api/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ riskPreference: 'yolo' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET reflects updated settings', () => {
    it('should return updated values after PUT', async () => {
      await request(app)
        .put('/api/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ aiModel: 'qwen', riskPreference: 'conservative' });

      const res = await request(app)
        .get('/api/settings')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        aiModel: 'qwen',
        analysisFrequency: 60,
        riskPreference: 'conservative',
      });
    });
  });
});
