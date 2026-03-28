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
import notificationRoutes from './notificationRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/notification', notificationRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123' });
  return res.body.token;
}

describe('Notification Routes', () => {
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

  describe('GET /api/notification/settings', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/notification/settings');
      expect(res.status).toBe(401);
    });

    it('should return default settings (all enabled)', async () => {
      const res = await request(app)
        .get('/api/notification/settings')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(12);
      expect(res.body.every((s: any) => s.enabled === true)).toBe(true);
      expect(res.body.every((s: any) => s.messageType && s.label)).toBe(true);
    });
  });

  describe('PUT /api/notification/settings', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .put('/api/notification/settings')
        .send({ settings: [] });
      expect(res.status).toBe(401);
    });

    it('should update settings', async () => {
      const res = await request(app)
        .put('/api/notification/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({
          settings: [
            { messageType: 'analysis', enabled: false },
            { messageType: 'stop_loss_alert', enabled: false },
          ],
        });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const analysis = res.body.find((s: any) => s.messageType === 'analysis');
      const stopLoss = res.body.find((s: any) => s.messageType === 'stop_loss_alert');
      expect(analysis.enabled).toBe(false);
      expect(stopLoss.enabled).toBe(false);
    });

    it('should return 400 for invalid body', async () => {
      const res = await request(app)
        .put('/api/notification/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({ settings: 'not-an-array' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET reflects updated settings', () => {
    it('should return updated settings after PUT', async () => {
      await request(app)
        .put('/api/notification/settings')
        .set('Authorization', `Bearer ${token}`)
        .send({
          settings: [{ messageType: 'deep_report', enabled: false }],
        });

      const res = await request(app)
        .get('/api/notification/settings')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const deepReport = res.body.find((s: any) => s.messageType === 'deep_report');
      expect(deepReport.enabled).toBe(false);

      // Others still enabled
      const ambush = res.body.find((s: any) => s.messageType === 'ambush');
      expect(ambush.enabled).toBe(true);
    });
  });
});
