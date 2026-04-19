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

// Mock AI provider factory
jest.mock('../ai/aiProviderFactory', () => ({
  getAIProvider: () => ({
    analyze: jest.fn(),
    chat: jest.fn().mockResolvedValue(
      '=== 结论 ===\n测试结论\n=== 基本面 ===\n测试基本面\n=== 财务数据 ===\n测试财务\n=== 估值分位 ===\n测试估值\n=== 交易策略 ===\n测试策略'
    ),
    getModelName: () => 'mock-model',
  }),
}));

// Mock market data service
jest.mock('../market/marketDataService', () => ({
  getQuote: jest.fn().mockResolvedValue({
    stockCode: '600000',
    stockName: '浦发银行',
    price: 11.5,
    changePercent: 2.3,
    volume: 1000000,
    timestamp: new Date().toISOString(),
  }),
}));

// Mock news service
jest.mock('../news/newsService', () => ({
  getNews: jest.fn().mockResolvedValue([]),
}));

import authRoutes from '../auth/authRoutes';
import deepAnalysisRoutes from './deepAnalysisRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/analysis/deep', deepAnalysisRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express, username = 'testuser'): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'pass123', agreedTerms: true });
  return res.body.token;
}

function seedDeepReport(
  db: Database.Database,
  userId: number,
  stockCode: string,
  status: 'generating' | 'completed' | 'failed' = 'completed'
): number {
  const now = new Date().toISOString();
  const today = now.split('T')[0];
  const result = db.prepare(
    `INSERT INTO deep_reports (user_id, stock_code, stock_name, conclusion, fundamentals, financials, valuation, strategy, ai_model, confidence, data_cutoff_date, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, stockCode, '浦发银行', '测试结论', '测试基本面', '测试财务', '测试估值', '测试策略', 'mock-model', 75, today, status, now);
  return Number(result.lastInsertRowid);
}

describe('Deep Analysis Routes', () => {
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

  describe('POST /api/analysis/deep/:stockCode', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/api/analysis/deep/600000');
      expect(res.status).toBe(401);
    });

    it('should start deep report generation and return reportId', async () => {
      const res = await request(app)
        .post('/api/analysis/deep/600000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.reportId).toBeDefined();
      expect(typeof res.body.reportId).toBe('number');
      expect(res.body.status).toBe('generating');
    });

    it('should return cached report id if recent report exists', async () => {
      // Seed a completed report within 24h
      const userId = testDb.prepare('SELECT id FROM users WHERE username = ?').get('testuser') as { id: number };
      const existingId = seedDeepReport(testDb, userId.id, '600000', 'completed');

      const res = await request(app)
        .post('/api/analysis/deep/600000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.reportId).toBe(existingId);
    });
  });

  describe('GET /api/analysis/deep/:reportId', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .get('/api/analysis/deep/1');
      expect(res.status).toBe(401);
    });

    it('should return 400 for invalid reportId', async () => {
      const res = await request(app)
        .get('/api/analysis/deep/abc')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it('should return 404 for non-existent report', async () => {
      const res = await request(app)
        .get('/api/analysis/deep/99999')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('should return report by id', async () => {
      const userId = testDb.prepare('SELECT id FROM users WHERE username = ?').get('testuser') as { id: number };
      const reportId = seedDeepReport(testDb, userId.id, '600000', 'completed');

      const res = await request(app)
        .get(`/api/analysis/deep/${reportId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(reportId);
      expect(res.body.stockCode).toBe('600000');
      expect(res.body.conclusion).toBe('测试结论');
      expect(res.body.status).toBe('completed');
    });

    it('should return 404 when report belongs to another user', async () => {
      const userId = testDb.prepare('SELECT id FROM users WHERE username = ?').get('testuser') as { id: number };
      const reportId = seedDeepReport(testDb, userId.id, '600000', 'completed');
      const otherToken = await registerAndGetToken(app, 'otheruser');

      const res = await request(app)
        .get(`/api/analysis/deep/${reportId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/analysis/deep/history', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app)
        .get('/api/analysis/deep/history');
      expect(res.status).toBe(401);
    });

    it('should return empty history', async () => {
      const res = await request(app)
        .get('/api/analysis/deep/history')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.reports).toEqual([]);
      expect(res.body.total).toBe(0);
      expect(res.body.hasMore).toBe(false);
    });

    it('should return paginated history', async () => {
      const userId = testDb.prepare('SELECT id FROM users WHERE username = ?').get('testuser') as { id: number };
      seedDeepReport(testDb, userId.id, '600000');
      seedDeepReport(testDb, userId.id, '000001');

      const res = await request(app)
        .get('/api/analysis/deep/history?page=1&limit=10')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.reports).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it('should filter by stockCode', async () => {
      const userId = testDb.prepare('SELECT id FROM users WHERE username = ?').get('testuser') as { id: number };
      seedDeepReport(testDb, userId.id, '600000');
      seedDeepReport(testDb, userId.id, '000001');

      const res = await request(app)
        .get('/api/analysis/deep/history?stockCode=600000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.reports).toHaveLength(1);
      expect(res.body.reports[0].stockCode).toBe('600000');
    });

    it('should not include other users reports in history', async () => {
      const userId = testDb.prepare('SELECT id FROM users WHERE username = ?').get('testuser') as { id: number };
      seedDeepReport(testDb, userId.id, '600000');
      const otherToken = await registerAndGetToken(app, 'historyother');

      const res = await request(app)
        .get('/api/analysis/deep/history')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.reports).toEqual([]);
      expect(res.body.total).toBe(0);
    });
  });
});
