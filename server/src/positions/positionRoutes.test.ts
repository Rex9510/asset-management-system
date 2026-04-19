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
import positionRoutes from './positionRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/positions', positionRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express, username = 'testuser'): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'pass123', agreedTerms: true });
  return res.body.token;
}

describe('Position Routes', () => {
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
    jest.restoreAllMocks();
  });

  describe('GET /api/positions', () => {
    it('should return empty array when no positions', async () => {
      const res = await request(app)
        .get('/api/positions')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.positions).toEqual([]);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/positions');
      expect(res.status).toBe(401);
    });

    it('should return positions after creation', async () => {
      await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600000', stockName: '浦发银行', costPrice: 10.5, shares: 100, buyDate: '2024-01-15' });

      const res = await request(app)
        .get('/api/positions')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.positions).toHaveLength(1);
      expect(res.body.positions[0].stockCode).toBe('600000');
      expect(res.body.positions[0].positionType).toBe('holding');
    });

    it('should filter by type=holding', async () => {
      await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' });
      await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '000001', stockName: '平安银行', positionType: 'watching' });

      const res = await request(app)
        .get('/api/positions?type=holding')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.positions).toHaveLength(1);
      expect(res.body.positions[0].positionType).toBe('holding');
    });

    it('should filter by type=watching', async () => {
      await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' });
      await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '000001', stockName: '平安银行', positionType: 'watching' });

      const res = await request(app)
        .get('/api/positions?type=watching')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.positions).toHaveLength(1);
      expect(res.body.positions[0].positionType).toBe('watching');
    });

    it('should return 400 for invalid type', async () => {
      const res = await request(app)
        .get('/api/positions?type=invalid')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/positions', () => {
    it('should create a holding position with valid data', async () => {
      const res = await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600000', stockName: '浦发银行', costPrice: 10.5, shares: 100, buyDate: '2024-01-15' });

      expect(res.status).toBe(201);
      expect(res.body.position.stockCode).toBe('600000');
      expect(res.body.position.positionType).toBe('holding');
      expect(res.body.position.costPrice).toBe(10.5);
      expect(res.body.position.shares).toBe(100);
      expect(res.body.position.buyDate).toBe('2024-01-15');
      expect(res.body.position.holdingDays).toBeGreaterThanOrEqual(0);
    });

    it('should create a watching position', async () => {
      const res = await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '000001', stockName: '平安银行', positionType: 'watching' });

      expect(res.status).toBe(201);
      expect(res.body.position.stockCode).toBe('000001');
      expect(res.body.position.positionType).toBe('watching');
      expect(res.body.position.costPrice).toBeNull();
      expect(res.body.position.shares).toBeNull();
      expect(res.body.position.buyDate).toBeNull();
      expect(res.body.position.holdingDays).toBeNull();
    });

    it('should reject invalid stock code', async () => {
      const res = await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '999999', stockName: '测试', costPrice: 10, shares: 100, buyDate: '2024-01-15' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('股票代码无效');
    });

    it('should reject non-positive cost price', async () => {
      const res = await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600000', stockName: '浦发银行', costPrice: -5, shares: 100, buyDate: '2024-01-15' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('成本价必须为正数');
    });

    it('should reject non-integer shares', async () => {
      const res = await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 1.5, buyDate: '2024-01-15' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('份额必须为正整数');
    });

    it('should reject invalid buy date', async () => {
      const res = await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: 'bad-date' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('买入日期格式无效');
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/api/positions')
        .send({ stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' });

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/positions/:id', () => {
    let positionId: number;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' });
      positionId = res.body.position.id;
    });

    it('should update cost price', async () => {
      const res = await request(app)
        .put(`/api/positions/${positionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ costPrice: 12 });

      expect(res.status).toBe(200);
      expect(res.body.position.costPrice).toBe(12);
      expect(res.body.position.shares).toBe(100);
    });

    it('should update shares', async () => {
      const res = await request(app)
        .put(`/api/positions/${positionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ shares: 200 });

      expect(res.status).toBe(200);
      expect(res.body.position.shares).toBe(200);
    });

    it('should update buy date', async () => {
      const res = await request(app)
        .put(`/api/positions/${positionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ buyDate: '2023-08-01' });

      expect(res.status).toBe(200);
      expect(res.body.position.buyDate).toBe('2023-08-01');
    });

    it('should recalculate P&L after update when market data exists', async () => {
      testDb.prepare('INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES (?, ?, ?, ?)').run('600000', '浦发银行', 15, 5.0);

      const res = await request(app)
        .put(`/api/positions/${positionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ costPrice: 12 });

      expect(res.status).toBe(200);
      expect(res.body.position.currentPrice).toBe(15);
      expect(res.body.position.profitLoss).toBe(300);
      expect(res.body.position.profitLossPercent).toBeCloseTo(25);
    });

    it('should return 404 for non-existent position', async () => {
      const res = await request(app)
        .put('/api/positions/999')
        .set('Authorization', `Bearer ${token}`)
        .send({ costPrice: 12 });

      expect(res.status).toBe(404);
    });

    it('should not update another user\'s position', async () => {
      const otherToken = await registerAndGetToken(app, 'otheruser');
      const res = await request(app)
        .put(`/api/positions/${positionId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ costPrice: 12 });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/positions/:id', () => {
    let positionId: number;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/positions')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' });
      positionId = res.body.position.id;
    });

    it('should delete a position', async () => {
      const res = await request(app)
        .delete(`/api/positions/${positionId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const getRes = await request(app)
        .get('/api/positions')
        .set('Authorization', `Bearer ${token}`);
      expect(getRes.body.positions).toHaveLength(0);
    });

    it('should return 404 for non-existent position', async () => {
      const res = await request(app)
        .delete('/api/positions/999')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('should not delete another user\'s position', async () => {
      const otherToken = await registerAndGetToken(app, 'otheruser');
      const res = await request(app)
        .delete(`/api/positions/${positionId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
    });
  });
});
