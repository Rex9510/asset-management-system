import request from 'supertest';
import Database from 'better-sqlite3';
import express from 'express';
import { initializeDatabase } from '../db/init';
import { errorHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/authMiddleware';
import { clearTokenBlacklist } from './authService';

// We need to mock the database connection for route tests
let testDb: Database.Database;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

// Import routes after mock setup
import authRoutes from './authRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);

  // A protected test endpoint
  app.get('/api/protected', authMiddleware, (req, res) => {
    res.json({ user: req.user });
  });

  app.use(errorHandler);
  return app;
}

describe('Auth Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');
    initializeDatabase(testDb);
    app = createApp();
  });

  afterEach(() => {
    testDb.close();
    clearTokenBlacklist();
    jest.restoreAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'newuser', password: 'pass123' });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.username).toBe('newuser');
      expect(res.body.user.id).toBeGreaterThan(0);
    });

    it('should reject duplicate username with 409', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ username: 'newuser', password: 'pass123' });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'newuser', password: 'other' });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('用户名已被占用');
    });

    it('should reject empty body with 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', password: 'pass123' });
    });

    it('should login with correct credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'pass123' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.username).toBe('testuser');
    });

    it('should reject wrong password with 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'wrong' });

      expect(res.status).toBe(401);
    });

    it('should lock account after 5 failed attempts', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({ username: 'testuser', password: 'wrong' });
      }

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'pass123' });

      expect(res.status).toBe(423);
      expect(res.body.error.message).toContain('锁定');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout and invalidate token', async () => {
      const registerRes = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', password: 'pass123' });

      const token = registerRes.body.token;

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(logoutRes.status).toBe(200);

      // Token should now be invalid
      const protectedRes = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(protectedRes.status).toBe(401);
    });

    it('should reject logout without token', async () => {
      const res = await request(app)
        .post('/api/auth/logout');

      expect(res.status).toBe(401);
    });
  });

  describe('JWT Auth Middleware', () => {
    it('should allow access with valid token', async () => {
      const registerRes = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', password: 'pass123' });

      const token = registerRes.body.token;

      const res = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('testuser');
    });

    it('should reject request without Authorization header', async () => {
      const res = await request(app).get('/api/protected');

      expect(res.status).toBe(401);
    });

    it('should reject request with invalid token', async () => {
      const res = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
    });

    it('should reject request with malformed Authorization header', async () => {
      const res = await request(app)
        .get('/api/protected')
        .set('Authorization', 'NotBearer token');

      expect(res.status).toBe(401);
    });
  });
});
