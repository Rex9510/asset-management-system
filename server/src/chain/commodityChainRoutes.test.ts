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
import commodityChainRoutes from './commodityChainRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/chain', commodityChainRoutes);
  app.use(errorHandler);
  return app;
}

async function registerAndGetToken(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'pass123', agreedTerms: true });
  return res.body.token;
}

function seedChainStatus(db: Database.Database): void {
  const now = new Date().toISOString();
  const nodes = [
    { index: 0, symbol: '518880', name: '黄金', shortName: 'Au', status: 'activated', change10d: 5.2 },
    { index: 1, symbol: '161226', name: '白银', shortName: 'Ag', status: 'transmitting', change10d: 2.1 },
    { index: 2, symbol: '512400', name: '有色', shortName: 'Cu', status: 'inactive', change10d: 0.5 },
    { index: 3, symbol: '515220', name: '煤炭', shortName: '煤', status: 'inactive', change10d: -1.0 },
    { index: 4, symbol: '516020', name: '化工', shortName: '化', status: 'inactive', change10d: 0.3 },
    { index: 5, symbol: '159886', name: '橡胶', shortName: '胶', status: 'transmitting', change10d: 1.5 },
    { index: 6, symbol: '161129', name: '原油', shortName: '油', status: 'activated', change10d: 4.0 },
  ];
  const stmt = db.prepare(
    `INSERT INTO chain_status (node_index, symbol, name, short_name, status, change_10d, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const n of nodes) {
    stmt.run(n.index, n.symbol, n.name, n.shortName, n.status, n.change10d, now);
  }
}

describe('Commodity Chain Routes', () => {
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

  describe('GET /api/chain/status', () => {
    it('should return 401 without auth', async () => {
      const res = await request(app).get('/api/chain/status');
      expect(res.status).toBe(401);
    });

    it('should return 404 when no chain data exists', async () => {
      const res = await request(app)
        .get('/api/chain/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('暂无传导链数据');
    });

    it('should return chain status when seeded', async () => {
      seedChainStatus(testDb);

      const res = await request(app)
        .get('/api/chain/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.nodes).toHaveLength(7);
      expect(res.body.updatedAt).toBeDefined();

      // Verify first node
      expect(res.body.nodes[0].symbol).toBe('518880');
      expect(res.body.nodes[0].name).toBe('黄金');
      expect(res.body.nodes[0].shortName).toBe('Au');
      expect(res.body.nodes[0].status).toBe('activated');
      expect(res.body.nodes[0].change10d).toBe(5.2);

      // Verify transmitting node
      expect(res.body.nodes[1].status).toBe('transmitting');

      // Verify inactive node
      expect(res.body.nodes[2].status).toBe('inactive');
    });

    it('should return nodes in correct order', async () => {
      seedChainStatus(testDb);

      const res = await request(app)
        .get('/api/chain/status')
        .set('Authorization', `Bearer ${token}`);

      const names = res.body.nodes.map((n: { name: string }) => n.name);
      expect(names).toEqual(['黄金', '白银', '有色', '煤炭', '化工', '橡胶', '原油']);
    });
  });
});
