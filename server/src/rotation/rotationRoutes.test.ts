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
import rotationRoutes from './rotationRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/rotation', rotationRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123' });
  return res.body.token;
}

function seedRotationStatus(db: Database.Database): void {
  db.prepare(
    `INSERT INTO rotation_status
     (current_phase, phase_label, tech_change_20d, tech_volume_ratio,
      cycle_change_20d, cycle_volume_ratio, consumer_change_20d, consumer_volume_ratio,
      previous_phase, switched_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('P1', '科技成长', 5.2, 1.3, 2.1, 0.9, 1.5, 1.0, null, null, new Date().toISOString());
}

describe('Rotation Routes', () => {
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

  describe('GET /api/rotation/current', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/rotation/current');
      expect(res.status).toBe(401);
    });

    it('should return null phase when no rotation data exists', async () => {
      const res = await request(app)
        .get('/api/rotation/current')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.currentPhase).toBeNull();
      expect(res.body.message).toBe('暂无轮动数据');
    });

    it('should return rotation data when seeded', async () => {
      seedRotationStatus(testDb);

      const res = await request(app)
        .get('/api/rotation/current')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.currentPhase).toBe('P1');
      expect(res.body.phaseLabel).toBe('科技成长');
      expect(res.body.etfPerformance).toBeDefined();
      expect(res.body.etfPerformance.tech.code).toBe('515000');
      expect(res.body.etfPerformance.tech.change20d).toBe(5.2);
      expect(res.body.etfPerformance.tech.volumeRatio).toBe(1.3);
      expect(res.body.etfPerformance.cycle.code).toBe('512400');
      expect(res.body.etfPerformance.consumer.code).toBe('159928');
      expect(res.body.updatedAt).toBeDefined();
    });
  });
});
