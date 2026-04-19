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
import snapshotRoutes from './snapshotRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/snapshot', snapshotRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123', agreedTerms: true });
  return res.body.token;
}

function seedSnapshotData(userId: number) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const insert = testDb.prepare(
    `INSERT INTO portfolio_snapshots
       (user_id, snapshot_date, stock_code, stock_name, shares, cost_price, market_price, market_value, profit_loss, sector)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insert.run(userId, yesterday, '600519', '贵州茅台', 100, 1800, 1850, 185000, 5000, '消费');
  insert.run(userId, yesterday, '000858', '五粮液', 200, 150, 155, 31000, 1000, '消费');
  insert.run(userId, today, '600519', '贵州茅台', 100, 1800, 1860, 186000, 6000, '消费');
  insert.run(userId, today, '000858', '五粮液', 200, 150, 158, 31600, 1600, '消费');
  insert.run(userId, today, '601318', '中国平安', 300, 50, 52, 15600, 600, '金融');
}

describe('Snapshot Routes', () => {
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

  describe('GET /api/snapshot/chart-data', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/snapshot/chart-data');
      expect(res.status).toBe(401);
    });

    it('should return empty chart data when no snapshots', async () => {
      const res = await request(app)
        .get('/api/snapshot/chart-data')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        profitCurve: [],
        profitCurveMeta: { hasCalendarGaps: false },
        sectorDistribution: [],
        stockPnl: [],
      });
    });

    it('should return chart data with default 30d period', async () => {
      seedSnapshotData(1);

      const res = await request(app)
        .get('/api/snapshot/chart-data')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.profitCurve)).toBe(true);
      expect(res.body.profitCurve.length).toBeGreaterThan(0);
      expect(res.body.profitCurve[0]).toHaveProperty('date');
      expect(res.body.profitCurve[0]).toHaveProperty('totalValue');
      expect(res.body.profitCurve[0]).toHaveProperty('totalProfit');
      expect(res.body.profitCurve[0]).toHaveProperty('totalCost');
      expect(res.body.profitCurve[0]).toHaveProperty('returnOnCostPct');
      expect(res.body.profitCurve[0]).toHaveProperty('dayMvChangePct');
      expect(res.body.profitCurve[0]).toHaveProperty('dayProfitDelta');
      expect(res.body.profitCurveMeta).toEqual(
        expect.objectContaining({ hasCalendarGaps: expect.any(Boolean) })
      );

      expect(Array.isArray(res.body.sectorDistribution)).toBe(true);
      expect(res.body.sectorDistribution.length).toBeGreaterThan(0);
      expect(res.body.sectorDistribution[0]).toHaveProperty('sector');
      expect(res.body.sectorDistribution[0]).toHaveProperty('percentage');

      expect(Array.isArray(res.body.stockPnl)).toBe(true);
      expect(res.body.stockPnl.length).toBeGreaterThan(0);
      expect(res.body.stockPnl[0]).toHaveProperty('stockCode');
      expect(res.body.stockPnl[0]).toHaveProperty('profitLoss');
    });

    it('should accept period=7d', async () => {
      seedSnapshotData(1);

      const res = await request(app)
        .get('/api/snapshot/chart-data?period=7d')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('profitCurve');
    });

    it('should accept period=90d', async () => {
      seedSnapshotData(1);

      const res = await request(app)
        .get('/api/snapshot/chart-data?period=90d')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('profitCurve');
    });

    it('should accept period=365d', async () => {
      seedSnapshotData(1);

      const res = await request(app)
        .get('/api/snapshot/chart-data?period=365d')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('profitCurve');
    });

    it('should default to 30d for invalid period', async () => {
      seedSnapshotData(1);

      const res = await request(app)
        .get('/api/snapshot/chart-data?period=invalid')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('profitCurve');
    });

    it('should return sector distribution with correct structure', async () => {
      seedSnapshotData(1);

      const res = await request(app)
        .get('/api/snapshot/chart-data')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const sectors = res.body.sectorDistribution;
      const totalPct = sectors.reduce((sum: number, s: any) => sum + s.percentage, 0);
      expect(totalPct).toBeCloseTo(100, 0);
    });

    it('should return stockPnl sorted descending by profitLoss', async () => {
      seedSnapshotData(1);

      const res = await request(app)
        .get('/api/snapshot/chart-data')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const pnl = res.body.stockPnl;
      for (let i = 1; i < pnl.length; i++) {
        expect(pnl[i - 1].profitLoss).toBeGreaterThanOrEqual(pnl[i].profitLoss);
      }
    });
  });
});
