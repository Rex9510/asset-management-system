import Database from 'better-sqlite3';
import { register, login, verifyToken, blacklistToken, isTokenBlacklisted } from './authService';
import { initializeDatabase } from '../db/init';
import { AppError } from '../errors/AppError';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db);
  return db;
}

describe('authService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_EXPIRES_IN = '1h';
  });

  afterEach(() => {
    db.close();
  });

  describe('register', () => {
    it('should register a new user and return token', () => {
      const result = register('testuser', 'password123', true, db);

      expect(result.token).toBeDefined();
      expect(result.user.username).toBe('testuser');
      expect(result.user.id).toBeGreaterThan(0);
    });

    it('should hash the password (not store plaintext)', () => {
      register('testuser', 'password123', true, db);

      const row = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('testuser') as { password_hash: string };
      expect(row.password_hash).not.toBe('password123');
      expect(row.password_hash).toMatch(/^\$2[aby]?\$/);
    });

    it('should reject duplicate username', () => {
      register('testuser', 'password123', true, db);

      expect(() => register('testuser', 'other', true, db)).toThrow(AppError);
      try {
        register('testuser', 'other', true, db);
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(409);
        expect(appErr.message).toContain('用户名已被占用');
      }
    });

    it('should reject empty username', () => {
      expect(() => register('', 'password123', true, db)).toThrow(AppError);
    });

    it('should reject empty password', () => {
      expect(() => register('testuser', '', true, db)).toThrow(AppError);
    });

    it('should return a valid JWT token', () => {
      const result = register('testuser', 'password123', true, db);
      const payload = verifyToken(result.token);

      expect(payload.id).toBe(result.user.id);
      expect(payload.username).toBe('testuser');
    });
  });

  describe('login', () => {
    beforeEach(() => {
      register('testuser', 'password123', true, db);
    });

    it('should login with correct credentials', () => {
      const result = login('testuser', 'password123', true, db);

      expect(result.token).toBeDefined();
      expect(result.user.username).toBe('testuser');
    });

    it('should reject wrong password', () => {
      expect(() => login('testuser', 'wrong', undefined, db)).toThrow(AppError);
      try {
        login('testuser', 'wrong', undefined, db);
      } catch (err) {
        expect((err as AppError).statusCode).toBe(401);
      }
    });

    it('should reject non-existent user', () => {
      expect(() => login('nouser', 'password123', undefined, db)).toThrow(AppError);
      try {
        login('nouser', 'password123', undefined, db);
      } catch (err) {
        expect((err as AppError).statusCode).toBe(401);
      }
    });

    it('should increment failed_login_count on wrong password', () => {
      try { login('testuser', 'wrong', undefined, db); } catch {}

      const row = db.prepare('SELECT failed_login_count FROM users WHERE username = ?').get('testuser') as { failed_login_count: number };
      expect(row.failed_login_count).toBe(1);
    });

    it('should lock account after 5 consecutive failed attempts', () => {
      for (let i = 0; i < 5; i++) {
        try { login('testuser', 'wrong', undefined, db); } catch {}
      }

      expect(() => login('testuser', 'password123', true, db)).toThrow(AppError);
      try {
        login('testuser', 'password123', true, db);
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(423);
        expect(appErr.message).toContain('锁定');
      }
    });

    it('should reset failed count on successful login', () => {
      try { login('testuser', 'wrong', undefined, db); } catch {}
      try { login('testuser', 'wrong', undefined, db); } catch {}

      login('testuser', 'password123', true, db);

      const row = db.prepare('SELECT failed_login_count FROM users WHERE username = ?').get('testuser') as { failed_login_count: number };
      expect(row.failed_login_count).toBe(0);
    });

    it('should unlock account after lock duration expires', () => {
      // Manually set locked_until to the past
      for (let i = 0; i < 5; i++) {
        try { login('testuser', 'wrong', undefined, db); } catch {}
      }

      const pastTime = new Date(Date.now() - 1000).toISOString();
      db.prepare('UPDATE users SET locked_until = ? WHERE username = ?').run(pastTime, 'testuser');

      const result = login('testuser', 'password123', true, db);
      expect(result.token).toBeDefined();
    });

    it('should reject empty credentials', () => {
      expect(() => login('', 'password123', undefined, db)).toThrow(AppError);
      expect(() => login('testuser', '', undefined, db)).toThrow(AppError);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const result = register('testuser', 'password123', true, db);
      const payload = verifyToken(result.token);

      expect(payload.id).toBe(result.user.id);
      expect(payload.username).toBe('testuser');
    });

    it('should reject an invalid token', () => {
      expect(() => verifyToken('invalid-token')).toThrow(AppError);
    });

    it('should reject a blacklisted token', () => {
      const result = register('testuser', 'password123', true, db);
      blacklistToken(result.token);

      expect(() => verifyToken(result.token)).toThrow(AppError);
      try {
        verifyToken(result.token);
      } catch (err) {
        expect((err as AppError).message).toContain('会话已失效');
      }
    });
  });

  describe('token blacklist', () => {
    it('should blacklist a token', () => {
      expect(isTokenBlacklisted('some-token')).toBe(false);
      blacklistToken('some-token');
      expect(isTokenBlacklisted('some-token')).toBe(true);
    });
  });
});
