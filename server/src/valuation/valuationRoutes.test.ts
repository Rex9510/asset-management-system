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

// Mock external API calls in valuationService
jest.mock('axios');

import authRoutes from '../auth/authRoutes';
import valuationRoutes from './valuationRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/valuation', valuationRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123' });
  return res.body.token;
}

function seedValuationCache(db: Database.Database, stockCode: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO valuation_cache (stock_code, pe_value, pb_value, pe_percentile, pb_percentile, pe_zone, pb_zone, data_years, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(stockCode, 15.2, 1.8, 25.5, 40.3, 'low', 'fair', 8, 'tencent', new Date().toISOString());
}

describe('Valuation Routes', () => {
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

  describe('GET /api/valuation/:stockCode', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/valuation/600000');
      expect(res.status).toBe(401);
    });

    it('should return valuation data from cache', async () => {
      seedValuationCache(testDb, '600000');

      const res = await request(app)
        .get('/api/valuation/600000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.stockCode).toBe('600000');
      expect(res.body.peValue).toBe(15.2);
      expect(res.body.pbValue).toBe(1.8);
      expect(res.body.pePercentile).toBe(25.5);
      expect(res.body.pbPercentile).toBe(40.3);
      expect(res.body.peZone).toBe('low');
      expect(res.body.pbZone).toBe('fair');
      expect(res.body.dataYears).toBe(8);
      expect(res.body.source).toBe('tencent');
      expect(res.body.updatedAt).toBeDefined();
    });
  });
});
