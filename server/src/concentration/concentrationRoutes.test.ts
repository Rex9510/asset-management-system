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
import concentrationRoutes from './concentrationRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/concentration', concentrationRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123', agreedTerms: true });
  return res.body.token;
}

function seedPositionsAndMarket(db: Database.Database, userId: number): void {
  // Insert positions
  db.prepare(
    `INSERT INTO positions (user_id, stock_code, stock_name, cost_price, shares, position_type)
     VALUES (?, ?, ?, ?, ?, 'holding')`
  ).run(userId, '600519', '贵州茅台', 1800, 100);

  db.prepare(
    `INSERT INTO positions (user_id, stock_code, stock_name, cost_price, shares, position_type)
     VALUES (?, ?, ?, ?, ?, 'holding')`
  ).run(userId, '601318', '中国平安', 50, 200);

  db.prepare(
    `INSERT INTO positions (user_id, stock_code, stock_name, cost_price, shares, position_type)
     VALUES (?, ?, ?, ?, ?, 'holding')`
  ).run(userId, '300750', '宁德时代', 200, 50);

  // Insert market cache prices
  db.prepare(
    `INSERT INTO market_cache (stock_code, stock_name, price, change_percent, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run('600519', '贵州茅台', 1900, 1.5);

  db.prepare(
    `INSERT INTO market_cache (stock_code, stock_name, price, change_percent, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run('601318', '中国平安', 55, 0.8);

  db.prepare(
    `INSERT INTO market_cache (stock_code, stock_name, price, change_percent, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run('300750', '宁德时代', 210, -0.5);
}

describe('Concentration Routes', () => {
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

  describe('GET /api/concentration', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/concentration');
      expect(res.status).toBe(401);
    });

    it('should return empty sectors when user has no positions', async () => {
      const res = await request(app)
        .get('/api/concentration')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sectors).toEqual([]);
      expect(res.body.totalValue).toBe(0);
      expect(res.body.riskWarning).toBeNull();
    });

    it('should return sector allocations with positions', async () => {
      // userId is 1 for the first registered user
      seedPositionsAndMarket(testDb, 1);

      const res = await request(app)
        .get('/api/concentration')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sectors.length).toBeGreaterThan(0);
      expect(res.body.totalValue).toBeGreaterThan(0);

      // Verify sector structure
      for (const sector of res.body.sectors) {
        expect(sector).toHaveProperty('sector');
        expect(sector).toHaveProperty('stockCount');
        expect(sector).toHaveProperty('totalValue');
        expect(sector).toHaveProperty('percentage');
        expect(sector.percentage).toBeGreaterThan(0);
        expect(sector.percentage).toBeLessThanOrEqual(100);
      }

      // Percentages should sum to ~100%
      const totalPct = res.body.sectors.reduce(
        (sum: number, s: { percentage: number }) => sum + s.percentage,
        0
      );
      expect(totalPct).toBeCloseTo(100, 0);
    });

    it('should include riskWarning when a sector exceeds 60%', async () => {
      // Seed a single large position so one sector dominates
      testDb.prepare(
        `INSERT INTO positions (user_id, stock_code, stock_name, cost_price, shares, position_type)
         VALUES (?, ?, ?, ?, ?, 'holding')`
      ).run(1, '600036', '招商银行', 30, 1000);

      testDb.prepare(
        `INSERT INTO market_cache (stock_code, stock_name, price, change_percent, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      ).run('600036', '招商银行', 35, 0.5);

      const res = await request(app)
        .get('/api/concentration')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      // Single sector = 100%, should trigger risk warning
      expect(res.body.riskWarning).toBeTruthy();
      expect(res.body.riskWarning).toContain('60%');
    });
  });
});
