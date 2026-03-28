import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import { register, login, verifyToken, clearTokenBlacklist } from './authService';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

// Arbitrary for valid usernames: 3-20 alphanumeric chars
const validUsername = fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 3, maxLength: 20 });

// Arbitrary for valid passwords: 6-30 printable ASCII chars
const validPassword = fc.stringOf(fc.char().filter(c => c.charCodeAt(0) >= 33 && c.charCodeAt(0) <= 126), { minLength: 6, maxLength: 30 });

beforeEach(() => {
  clearTokenBlacklist();
});

describe('属性测试：注册-登录往返', () => {
  it('对任意有效用户名密码，注册后用相同凭据登录应成功', () => {
    fc.assert(
      fc.property(validUsername, validPassword, (username, password) => {
        const db = makeDb();
        const regResult = register(username, password, db);
        expect(regResult.token).toBeTruthy();
        expect(regResult.user.username).toBe(username);

        const loginResult = login(username, password, db);
        expect(loginResult.token).toBeTruthy();
        expect(loginResult.user.username).toBe(username);
        expect(loginResult.user.id).toBe(regResult.user.id);
      }),
      { numRuns: 50 }
    );
  });
});

describe('属性测试：用户名唯一性约束', () => {
  it('对任意已注册用户名，重复注册应被拒绝', () => {
    fc.assert(
      fc.property(validUsername, validPassword, validPassword, (username, pw1, pw2) => {
        const db = makeDb();
        register(username, pw1, db);
        expect(() => register(username, pw2, db)).toThrow('用户名已被占用');
      }),
      { numRuns: 50 }
    );
  });
});

describe('属性测试：未认证请求拦截', () => {
  it('对任意无效 token，verifyToken 应抛出错误', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (fakeToken) => {
        expect(() => verifyToken(fakeToken)).toThrow();
      }),
      { numRuns: 100 }
    );
  });
});
