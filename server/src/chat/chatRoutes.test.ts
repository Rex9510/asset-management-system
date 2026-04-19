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

const mockChat = jest.fn();
jest.mock('../ai/aiProviderFactory', () => ({
  getAIProvider: () => ({
    analyze: jest.fn(),
    chat: mockChat,
    getModelName: () => 'mock-model',
  }),
}));

import authRoutes from '../auth/authRoutes';
import chatRoutes from './chatRoutes';
import calmDownRoutes from './calmDownRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/calm-down', calmDownRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express, username = 'testuser'): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'pass123', agreedTerms: true });
  return res.body.token;
}

describe('Chat Routes', () => {
  let app: express.Express;
  let token: string;

  beforeEach(async () => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = OFF');
    initializeDatabase(testDb);
    app = createApp();
    token = await registerAndGetToken(app);
    mockChat.mockReset();
    mockChat.mockResolvedValue('这是参考方案：当前走势分析。');
  });

  afterEach(() => {
    testDb.close();
    clearTokenBlacklist();
  });

  describe('POST /api/chat/send', () => {
    it('should send message and return AI response', async () => {
      const res = await request(app)
        .post('/api/chat/send')
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '帮我分析一下600000' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();
      expect(res.body.message.role).toBe('assistant');
      expect(res.body.message.content).toBe('这是参考方案：当前走势分析。');
      expect(res.body.sellIntentDetected).toBe(false);
    });

    it('should detect sell intent', async () => {
      const res = await request(app)
        .post('/api/chat/send')
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '我想卖掉这只股票' });

      expect(res.status).toBe(200);
      expect(res.body.sellIntentDetected).toBe(true);
    });

    it('should accept optional stockCode', async () => {
      const res = await request(app)
        .post('/api/chat/send')
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '分析一下', stockCode: '600000' });

      expect(res.status).toBe(200);
      expect(res.body.message.stockCode).toBe('600000');
    });

    it('should return 400 for empty content', async () => {
      const res = await request(app)
        .post('/api/chat/send')
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '' });

      expect(res.status).toBe(400);
    });

    it('should return 400 for missing content', async () => {
      const res = await request(app)
        .post('/api/chat/send')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/api/chat/send')
        .send({ content: '你好' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/chat/history', () => {
    it('should return empty array when no messages', async () => {
      const res = await request(app)
        .get('/api/chat/history')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.messages).toEqual([]);
    });

    it('should return messages after sending', async () => {
      await request(app)
        .post('/api/chat/send')
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '你好' });

      const res = await request(app)
        .get('/api/chat/history')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.messages[0].role).toBe('user');
      expect(res.body.messages[1].role).toBe('assistant');
    });

    it('should respect limit query parameter', async () => {
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/chat/send')
          .set('Authorization', `Bearer ${token}`)
          .send({ content: `消息${i}` });
      }

      const res = await request(app)
        .get('/api/chat/history?limit=2')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(2);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .get('/api/chat/history');

      expect(res.status).toBe(401);
    });

    it('should not return other user messages', async () => {
      await request(app)
        .post('/api/chat/send')
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '你好' });

      const otherToken = await registerAndGetToken(app, 'otheruser');
      const res = await request(app)
        .get('/api/chat/history')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.messages).toEqual([]);
    });
  });

  describe('POST /api/calm-down/evaluate', () => {
    it('should return calm-down evaluation', async () => {
      mockChat.mockResolvedValue(JSON.stringify({
        buyLogicReview: '买入逻辑回顾',
        sellJudgment: 'emotional',
        worstCaseEstimate: '最坏情况预估',
        recommendation: '参考方案：冷静分析',
      }));

      const res = await request(app)
        .post('/api/calm-down/evaluate')
        .set('Authorization', `Bearer ${token}`)
        .send({ stockCode: '600000' });

      expect(res.status).toBe(200);
      expect(res.body.evaluation).toBeDefined();
      expect(res.body.evaluation.buyLogicReview).toBe('买入逻辑回顾');
      expect(res.body.evaluation.sellJudgment).toBe('emotional');
      expect(res.body.evaluation.worstCaseEstimate).toBe('最坏情况预估');
      expect(res.body.evaluation.recommendation).toBe('参考方案：冷静分析');
    });

    it('should return 400 without stockCode', async () => {
      const res = await request(app)
        .post('/api/calm-down/evaluate')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/api/calm-down/evaluate')
        .send({ stockCode: '600000' });

      expect(res.status).toBe(401);
    });
  });
});
