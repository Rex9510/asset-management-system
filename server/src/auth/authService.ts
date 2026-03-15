import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { AppError, Errors } from '../errors/AppError';

const SALT_ROUNDS = 10;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

function getJwtSecret(): string {
  return process.env.JWT_SECRET || 'default-dev-secret';
}

function getJwtExpiresIn(): SignOptions['expiresIn'] {
  return (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'];
}

export interface AuthResult {
  token: string;
  user: { id: number; username: string };
}

// Token blacklist for logout (in-memory, resets on server restart)
const tokenBlacklist = new Set<string>();

export function isTokenBlacklisted(token: string): boolean {
  return tokenBlacklist.has(token);
}

export function blacklistToken(token: string): void {
  tokenBlacklist.add(token);
}

/** Clear all blacklisted tokens (for testing only) */
export function clearTokenBlacklist(): void {
  tokenBlacklist.clear();
}

export function register(
  username: string,
  password: string,
  db?: Database.Database
): AuthResult {
  const database = db || getDatabase();

  if (!username || !password) {
    throw Errors.badRequest('用户名和密码不能为空');
  }

  const existing = database
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(username);

  if (existing) {
    throw new AppError(409, 'CONFLICT', '用户名已被占用，请更换');
  }

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);

  const result = database
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, passwordHash);

  const userId = result.lastInsertRowid as number;

  const token = jwt.sign(
    { id: userId, username },
    getJwtSecret(),
    { expiresIn: getJwtExpiresIn() }
  );

  return { token, user: { id: userId, username } };
}

export function login(
  username: string,
  password: string,
  db?: Database.Database
): AuthResult {
  const database = db || getDatabase();

  if (!username || !password) {
    throw Errors.badRequest('用户名和密码不能为空');
  }

  const user = database
    .prepare('SELECT id, username, password_hash, failed_login_count, locked_until FROM users WHERE username = ?')
    .get(username) as {
      id: number;
      username: string;
      password_hash: string;
      failed_login_count: number;
      locked_until: string | null;
    } | undefined;

  if (!user) {
    throw Errors.unauthorized('用户名或密码错误');
  }

  // Check if account is locked
  if (user.locked_until) {
    const lockUntil = new Date(user.locked_until).getTime();
    if (Date.now() < lockUntil) {
      throw new AppError(423, 'ACCOUNT_LOCKED', '账户已锁定，请15分钟后再试');
    }
    // Lock expired, reset
    database
      .prepare('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?')
      .run(user.id);
  }

  const passwordMatch = bcrypt.compareSync(password, user.password_hash);

  if (!passwordMatch) {
    const newCount = (user.failed_login_count || 0) + 1;

    if (newCount >= MAX_FAILED_ATTEMPTS) {
      const lockUntil = new Date(
        Date.now() + LOCK_DURATION_MINUTES * 60 * 1000
      ).toISOString();
      database
        .prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?')
        .run(newCount, lockUntil, user.id);
      throw new AppError(423, 'ACCOUNT_LOCKED', '连续登录失败5次，账户已锁定15分钟');
    }

    database
      .prepare('UPDATE users SET failed_login_count = ? WHERE id = ?')
      .run(newCount, user.id);

    throw Errors.unauthorized('用户名或密码错误');
  }

  // Reset failed attempts on successful login
  database
    .prepare('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?')
    .run(user.id);

  const token = jwt.sign(
    { id: user.id, username: user.username },
    getJwtSecret(),
    { expiresIn: getJwtExpiresIn() }
  );

  return { token, user: { id: user.id, username: user.username } };
}

export function verifyToken(token: string): { id: number; username: string } {
  if (isTokenBlacklisted(token)) {
    throw Errors.unauthorized('会话已失效，请重新登录');
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as {
      id: number;
      username: string;
    };
    return { id: payload.id, username: payload.username };
  } catch {
    throw Errors.unauthorized('无效的认证令牌');
  }
}
