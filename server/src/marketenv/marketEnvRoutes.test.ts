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
import marketEnvRoutes from './marketEnvRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/market-env', marketEnvRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123', agreedTerms: true });
  return res.body.token;
}

function seedMarketEnv(db: Database.Database): void {
  db.prepare(
    `INSERT INTO market_environment
     (environment, label, confidence_adjust, risk_tip,
      sh_ma20_trend, sh_ma60_trend, hs300_ma20_trend, hs300_ma60_trend,
      volume_change, advance_decline_ratio, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('sideways', '震荡 ⚖️', 0, null, 'up', 'down', 'down', 'up', 0.95, 1.1, new Date().toISOString());
}

function seedBearMarketEnv(db: Database.Database): void {
  db.prepare(
    `INSERT INTO market_environment
     (environment, label, confidence_adjust, risk_tip,
      sh_ma20_trend, sh_ma60_trend, hs300_ma20_trend, hs300_ma60_trend,
      volume_change, advance_decline_ratio, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('bear', '熊市 🐻', -15, '当前大盘处于熊市环境，操作需谨慎，注意控制仓位',
    'down', 'above_ma20', 'down', 'above_ma20', 0.7, 0.5, new Date().toISOString());
}

describe('MarketEnv Routes', () => {
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

  describe('GET /api/market-env/current', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/market-env/current');
      expect(res.status).toBe(401);
    });

    it('should return 404 when no market env data exists', async () => {
      const res = await request(app)
        .get('/api/market-env/current')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('暂无大盘环境数据');
    });

    it('should return sideways market env data when seeded', async () => {
      seedMarketEnv(testDb);

      const res = await request(app)
        .get('/api/market-env/current')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.environment).toBe('sideways');
      expect(res.body.label).toBe('震荡 ⚖️');
      expect(res.body.confidenceAdjust).toBe(0);
      expect(res.body.riskTip).toBeNull();
      expect(res.body.indicators).toBeDefined();
      expect(res.body.indicators.shIndex.ma20Trend).toBe('up');
      expect(res.body.indicators.volumeChange).toBe(0.95);
      expect(res.body.indicators.advanceDeclineRatio).toBe(1.1);
      expect(res.body.updatedAt).toBeDefined();
    });

    it('should return bear market env with risk tip', async () => {
      seedBearMarketEnv(testDb);

      const res = await request(app)
        .get('/api/market-env/current')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.environment).toBe('bear');
      expect(res.body.label).toBe('熊市 🐻');
      expect(res.body.confidenceAdjust).toBe(-15);
      expect(res.body.riskTip).toBe('当前大盘处于熊市环境，操作需谨慎，注意控制仓位');
    });
  });
});
