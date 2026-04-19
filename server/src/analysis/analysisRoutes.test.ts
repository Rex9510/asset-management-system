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
const mockAnalyze = jest.fn();
jest.mock('../ai/aiProviderFactory', () => ({
  getAIProvider: () => ({
    analyze: mockAnalyze,
    chat: jest.fn(),
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
import analysisRoutes from './analysisRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/analysis', analysisRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express, username = 'testuser'): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'pass123', agreedTerms: true });
  return res.body.token;
}

describe('Analysis Routes', () => {
  let app: express.Express;
  let token: string;

  beforeEach(async () => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');
    initializeDatabase(testDb);
    app = createApp();
    token = await registerAndGetToken(app);

    // Make the test user an "old" user (60 days) to avoid cold-start records from trust service
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    testDb.prepare('UPDATE users SET created_at = ? WHERE username = ?')
      .run(sixtyDaysAgo.toISOString(), 'testuser');

    mockAnalyze.mockResolvedValue({
      stage: 'rising',
      spaceEstimate: '上方空间约10%',
      keySignals: ['MACD金叉'],
      actionRef: 'hold',
      batchPlan: [],
      confidence: 75,
      reasoning: '当前处于上升趋势，参考方案为持有。',
      riskAlerts: [],
    });
  });

  afterEach(() => {
    testDb.close();
    clearTokenBlacklist();
    jest.restoreAllMocks();
  });

  describe('POST /api/analysis/trigger', () => {
    it('should trigger analysis and return result', async () => {
      const res = await request(app)
        .post('/api/analysis/trigger')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600000' });

      expect(res.status).toBe(200);
      expect(res.body.analysis).toBeDefined();
      expect(res.body.analysis.stockCode).toBe('600000');
      expect(res.body.analysis.stage).toBe('rising');
      expect(res.body.analysis.confidence).toBe(75);
      expect(res.body.analysis.triggerType).toBe('manual');
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/api/analysis/trigger')
        .send({ stockCode: '600000' });

      expect(res.status).toBe(401);
    });

    it('should return 400 without stockCode', async () => {
      const res = await request(app)
        .post('/api/analysis/trigger')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid stock code', async () => {
      const res = await request(app)
        .post('/api/analysis/trigger')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '999999' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('股票代码无效');
    });
  });

  describe('GET /api/analysis/:stockCode', () => {
    it('should return empty array when no analyses', async () => {
      const res = await request(app)
        .get('/api/analysis/600000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.analyses).toEqual([]);
    });

    it('should return analyses after trigger', async () => {
      await request(app)
        .post('/api/analysis/trigger')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600000' });

      const res = await request(app)
        .get('/api/analysis/600000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.analyses).toHaveLength(1);
      expect(res.body.analyses[0].stockCode).toBe('600000');
    });

    it('should respect limit query parameter', async () => {
      // Trigger 3 analyses
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/analysis/trigger')
          .set('Authorization', `Bearer ${token}`)
          .send({ stockCode: '600000' });
      }

      const res = await request(app)
        .get('/api/analysis/600000?limit=2')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.analyses).toHaveLength(2);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .get('/api/analysis/600000');

      expect(res.status).toBe(401);
    });

    it('should not return other user analyses', async () => {
      // Trigger analysis as first user
      await request(app)
        .post('/api/analysis/trigger')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600000' });

      // Register second user and make them old too
      const otherToken = await registerAndGetToken(app, 'otheruser');
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      testDb.prepare('UPDATE users SET created_at = ? WHERE username = ?')
        .run(sixtyDaysAgo.toISOString(), 'otheruser');

      const res = await request(app)
        .get('/api/analysis/600000')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.analyses).toHaveLength(0);
    });
  });
});
