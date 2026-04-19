import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  isValidStockCode,
  isValidDate,
  calculateHoldingDays,
  calculateProfitLoss,
  calculateProfitLossPercent,
  getPositions,
  getPositionById,
  createPosition,
  updatePosition,
  deletePosition,
} from './positionService';
import { AppError } from '../errors/AppError';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db);
  return db;
}

function createTestUser(db: Database.Database, username = 'testuser'): number {
  const result = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, '$2a$10$fakehash');
  return result.lastInsertRowid as number;
}

describe('positionService', () => {
  let db: Database.Database;
  let userId: number;

  beforeEach(() => {
    db = createTestDb();
    userId = createTestUser(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('isValidStockCode', () => {
    it('should accept valid Shanghai main board codes (600xxx)', () => {
      expect(isValidStockCode('600000')).toBe(true);
      expect(isValidStockCode('601318')).toBe(true);
      expect(isValidStockCode('603288')).toBe(true);
      expect(isValidStockCode('605499')).toBe(true);
    });

    it('should accept valid Shenzhen main board codes (000xxx)', () => {
      expect(isValidStockCode('000001')).toBe(true);
      expect(isValidStockCode('002594')).toBe(true);
    });

    it('should accept valid ChiNext codes (300xxx/301xxx)', () => {
      expect(isValidStockCode('300750')).toBe(true);
      expect(isValidStockCode('301269')).toBe(true);
    });

    it('should accept valid STAR Market codes (688xxx/689xxx)', () => {
      expect(isValidStockCode('688981')).toBe(true);
      expect(isValidStockCode('689009')).toBe(true);
    });

    it('should accept on-exchange ETF / LOF codes (51x/56x/58x/159/161 etc.)', () => {
      expect(isValidStockCode('515220')).toBe(true);
      expect(isValidStockCode('518880')).toBe(true);
      expect(isValidStockCode('159985')).toBe(true);
      expect(isValidStockCode('161129')).toBe(true);
      expect(isValidStockCode('512400')).toBe(true);
    });

    it('should reject codes with invalid prefixes', () => {
      expect(isValidStockCode('100000')).toBe(false);
      expect(isValidStockCode('400001')).toBe(false);
      expect(isValidStockCode('999999')).toBe(false);
    });

    it('should reject codes that are not 6 digits', () => {
      expect(isValidStockCode('60000')).toBe(false);
      expect(isValidStockCode('6000001')).toBe(false);
      expect(isValidStockCode('')).toBe(false);
      expect(isValidStockCode('abcdef')).toBe(false);
    });
  });

  describe('isValidDate', () => {
    it('should accept valid dates', () => {
      expect(isValidDate('2024-01-15')).toBe(true);
      expect(isValidDate('2023-12-31')).toBe(true);
    });

    it('should reject invalid date formats', () => {
      expect(isValidDate('2024/01/15')).toBe(false);
      expect(isValidDate('01-15-2024')).toBe(false);
      expect(isValidDate('not-a-date')).toBe(false);
    });

    it('should reject impossible dates', () => {
      expect(isValidDate('2024-02-30')).toBe(false);
      expect(isValidDate('2024-13-01')).toBe(false);
    });
  });

  describe('calculateHoldingDays', () => {
    it('should return 0 for today', () => {
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      expect(calculateHoldingDays(dateStr)).toBe(0);
    });

    it('should return positive days for past dates', () => {
      const past = new Date();
      past.setDate(past.getDate() - 10);
      const dateStr = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
      expect(calculateHoldingDays(dateStr)).toBe(10);
    });
  });

  describe('calculateProfitLoss', () => {
    it('should calculate profit correctly', () => {
      expect(calculateProfitLoss(10, 100, 15)).toBe(500);
    });

    it('should calculate loss correctly', () => {
      expect(calculateProfitLoss(10, 100, 8)).toBe(-200);
    });

    it('should return 0 when prices are equal', () => {
      expect(calculateProfitLoss(10, 100, 10)).toBe(0);
    });
  });

  describe('calculateProfitLossPercent', () => {
    it('should calculate profit percentage correctly', () => {
      expect(calculateProfitLossPercent(10, 15)).toBe(50);
    });

    it('should calculate loss percentage correctly', () => {
      expect(calculateProfitLossPercent(10, 8)).toBe(-20);
    });

    it('should return 0 when prices are equal', () => {
      expect(calculateProfitLossPercent(10, 10)).toBe(0);
    });
  });

  describe('createPosition', () => {
    it('should create a holding position with valid data', async () => {
      const position = await createPosition(userId, {
        stockCode: '600000',
        stockName: '浦发银行',
        costPrice: 10.5,
        shares: 100,
        buyDate: '2024-01-15',
      }, db);

      expect(position.id).toBeGreaterThan(0);
      expect(position.stockCode).toBe('600000');
      expect(position.stockName).toBe('浦发银行');
      expect(position.positionType).toBe('holding');
      expect(position.costPrice).toBe(10.5);
      expect(position.shares).toBe(100);
      expect(position.buyDate).toBe('2024-01-15');
      expect(position.currentPrice).toBeNull();
      expect(position.profitLoss).toBeNull();
      expect(position.profitLossPercent).toBeNull();
    });

    it('should create a watching position with only code and name', async () => {
      const position = await createPosition(userId, {
        stockCode: '000001',
        stockName: '平安银行',
        positionType: 'watching',
      }, db);

      expect(position.id).toBeGreaterThan(0);
      expect(position.stockCode).toBe('000001');
      expect(position.positionType).toBe('watching');
      expect(position.costPrice).toBeNull();
      expect(position.shares).toBeNull();
      expect(position.buyDate).toBeNull();
      expect(position.profitLoss).toBeNull();
      expect(position.profitLossPercent).toBeNull();
      expect(position.holdingDays).toBeNull();
    });

    it('should default to holding type when positionType not specified', async () => {
      const position = await createPosition(userId, {
        stockCode: '600000',
        stockName: '浦发银行',
        costPrice: 10,
        shares: 100,
        buyDate: '2024-01-15',
      }, db);
      expect(position.positionType).toBe('holding');
    });

    it('should reject invalid stock code', async () => {
      await expect(
        createPosition(userId, {
          stockCode: '999999',
          stockName: '测试',
          costPrice: 10,
          shares: 100,
          buyDate: '2024-01-15',
        }, db)
      ).rejects.toThrow(AppError);
    });

    it('should reject empty stock name', async () => {
      await expect(
        createPosition(userId, {
          stockCode: '600000',
          stockName: '',
          costPrice: 10,
          shares: 100,
          buyDate: '2024-01-15',
        }, db)
      ).rejects.toThrow(AppError);
    });

    it('should reject non-positive cost price for holding', async () => {
      await expect(
        createPosition(userId, {
          stockCode: '600000',
          stockName: '浦发银行',
          costPrice: 0,
          shares: 100,
          buyDate: '2024-01-15',
        }, db)
      ).rejects.toThrow(AppError);

      await expect(
        createPosition(userId, {
          stockCode: '600000',
          stockName: '浦发银行',
          costPrice: -5,
          shares: 100,
          buyDate: '2024-01-15',
        }, db)
      ).rejects.toThrow(AppError);
    });

    it('should reject non-positive-integer shares for holding', async () => {
      await expect(
        createPosition(userId, {
          stockCode: '600000',
          stockName: '浦发银行',
          costPrice: 10,
          shares: 0,
          buyDate: '2024-01-15',
        }, db)
      ).rejects.toThrow(AppError);

      await expect(
        createPosition(userId, {
          stockCode: '600000',
          stockName: '浦发银行',
          costPrice: 10,
          shares: 1.5,
          buyDate: '2024-01-15',
        }, db)
      ).rejects.toThrow(AppError);
    });

    it('should reject invalid buy date for holding', async () => {
      await expect(
        createPosition(userId, {
          stockCode: '600000',
          stockName: '浦发银行',
          costPrice: 10,
          shares: 100,
          buyDate: 'not-a-date',
        }, db)
      ).rejects.toThrow(AppError);
    });

    it('should not require cost/shares/date for watching', async () => {
      const position = await createPosition(userId, {
        stockCode: '600000',
        stockName: '浦发银行',
        positionType: 'watching',
      }, db);
      expect(position.positionType).toBe('watching');
      expect(position.costPrice).toBeNull();
      expect(position.shares).toBeNull();
      expect(position.buyDate).toBeNull();
    });
  });

  describe('operation_logs', () => {
    it('records create, update, and delete', async () => {
      const p = await createPosition(
        userId,
        { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' },
        db
      );
      let logs = db.prepare('SELECT operation_type FROM operation_logs WHERE user_id = ? ORDER BY id').all(userId) as {
        operation_type: string;
      }[];
      expect(logs.map((l) => l.operation_type)).toEqual(['create']);

      updatePosition(p.id, userId, { costPrice: 11 }, db);
      logs = db.prepare('SELECT operation_type FROM operation_logs WHERE user_id = ? ORDER BY id').all(userId) as {
        operation_type: string;
      }[];
      expect(logs.map((l) => l.operation_type)).toEqual(['create', 'update']);

      deletePosition(p.id, userId, db);
      logs = db.prepare('SELECT operation_type FROM operation_logs WHERE user_id = ? ORDER BY id').all(userId) as {
        operation_type: string;
      }[];
      expect(logs.map((l) => l.operation_type)).toEqual(['create', 'update', 'delete']);
    });

    it('records watching create with null price and shares', async () => {
      await createPosition(
        userId,
        { stockCode: '600000', stockName: '浦发银行', positionType: 'watching' },
        db
      );
      const row = db.prepare('SELECT price, shares FROM operation_logs WHERE user_id = ?').get(userId) as {
        price: number | null;
        shares: number | null;
      };
      expect(row.price).toBeNull();
      expect(row.shares).toBeNull();
    });
  });

  describe('getPositions', () => {
    it('should return empty array when no positions', () => {
      const positions = getPositions(userId, db);
      expect(positions).toEqual([]);
    });

    it('should return all positions for a user', async () => {
      await createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      await createPosition(userId, { stockCode: '000001', stockName: '平安银行', costPrice: 12, shares: 200, buyDate: '2024-02-01' }, db);

      const positions = getPositions(userId, db);
      expect(positions).toHaveLength(2);
    });

    it('should filter by type', async () => {
      await createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      await createPosition(userId, { stockCode: '000001', stockName: '平安银行', positionType: 'watching' }, db);

      const holdings = getPositions(userId, db, 'holding');
      expect(holdings).toHaveLength(1);
      expect(holdings[0].positionType).toBe('holding');

      const watchings = getPositions(userId, db, 'watching');
      expect(watchings).toHaveLength(1);
      expect(watchings[0].positionType).toBe('watching');
    });

    it('should not return positions of other users', async () => {
      const otherUserId = createTestUser(db, 'otheruser');
      await createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      await createPosition(otherUserId, { stockCode: '000001', stockName: '平安银行', costPrice: 12, shares: 200, buyDate: '2024-02-01' }, db);

      const positions = getPositions(userId, db);
      expect(positions).toHaveLength(1);
      expect(positions[0].stockCode).toBe('600000');
    });

    it('should include current price and P&L when market_cache has data', async () => {
      await createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      db.prepare('INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES (?, ?, ?, ?)').run('600000', '浦发银行', 15, 5.0);

      const positions = getPositions(userId, db);
      expect(positions[0].currentPrice).toBe(15);
      expect(positions[0].profitLoss).toBe(500);
      expect(positions[0].profitLossPercent).toBe(50);
    });

    it('should not calculate P&L for watching positions', async () => {
      await createPosition(userId, { stockCode: '600000', stockName: '浦发银行', positionType: 'watching' }, db);
      db.prepare('INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES (?, ?, ?, ?)').run('600000', '浦发银行', 15, 5.0);

      const positions = getPositions(userId, db);
      expect(positions[0].currentPrice).toBe(15);
      expect(positions[0].profitLoss).toBeNull();
      expect(positions[0].profitLossPercent).toBeNull();
    });
  });

  describe('searchStockCandidates', () => {
    it('returns fallback candidate for valid code not in cache/hs300', async () => {
      const { searchStockCandidates } = require('./positionService') as typeof import('./positionService');
      const candidates = await searchStockCandidates('603596', db, 10);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toEqual({ stockCode: '603596', stockName: '603596' });
    });

    it('returns ETF from market_cache when searching Chinese name (not filtered as invalid code)', async () => {
      db.prepare(
        'INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES (?, ?, ?, ?)'
      ).run('515220', '煤炭ETF', 1.2, -0.5);
      const { searchStockCandidates } = require('./positionService') as typeof import('./positionService');
      const candidates = await searchStockCandidates('煤炭ETF', db, 10);
      expect(candidates.some((c) => c.stockCode === '515220' && c.stockName === '煤炭ETF')).toBe(true);
    });

    it('treats underscore in keyword as literal (not LIKE single-char wildcard)', async () => {
      db.prepare(
        'INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES (?, ?, ?, ?)'
      ).run('600010', 'testXcoin', 1, 0);
      db.prepare(
        'INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES (?, ?, ?, ?)'
      ).run('600011', 'test_coin', 1, 0);
      const { searchStockCandidates } = require('./positionService') as typeof import('./positionService');
      const candidates = await searchStockCandidates('test_coin', db, 10);
      const codes = candidates.map((c) => c.stockCode).sort();
      expect(codes).toContain('600011');
      expect(codes).not.toContain('600010');
    });

    it('treats percent in keyword as literal (not LIKE multi-char wildcard)', async () => {
      db.prepare(
        'INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES (?, ?, ?, ?)'
      ).run('600012', 'fooXbar', 1, 0);
      db.prepare(
        'INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES (?, ?, ?, ?)'
      ).run('600013', 'foo%bar', 1, 0);
      const { searchStockCandidates } = require('./positionService') as typeof import('./positionService');
      const candidates = await searchStockCandidates('foo%bar', db, 10);
      const codes = candidates.map((c) => c.stockCode).sort();
      expect(codes).toContain('600013');
      expect(codes).not.toContain('600012');
    });
  });

  describe('updatePosition', () => {
    it('should update cost price', async () => {
      const created = await createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      const updated = updatePosition(created.id, userId, { costPrice: 12 }, db);
      expect(updated.costPrice).toBe(12);
      expect(updated.shares).toBe(100);
    });

    it('should update shares', async () => {
      const created = await createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      const updated = updatePosition(created.id, userId, { shares: 200 }, db);
      expect(updated.shares).toBe(200);
      expect(updated.costPrice).toBe(10);
    });

    it('should reject update with no fields', async () => {
      const created = await createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      expect(() => updatePosition(created.id, userId, {}, db)).toThrow(AppError);
    });

    it('should update buy date only', async () => {
      const created = await createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      const updated = updatePosition(created.id, userId, { buyDate: '2023-06-01' }, db);
      expect(updated.buyDate).toBe('2023-06-01');
      expect(updated.costPrice).toBe(10);
      expect(updated.shares).toBe(100);
    });

    it('should reject invalid buyDate on update', async () => {
      const created = await createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      expect(() => updatePosition(created.id, userId, { buyDate: 'not-a-date' }, db)).toThrow(AppError);
    });

    it('should reject buyDate update for watching position', async () => {
      const created = await createPosition(userId, { stockCode: '600000', stockName: '浦发银行', positionType: 'watching' }, db);
      expect(() => updatePosition(created.id, userId, { buyDate: '2024-01-15' }, db)).toThrow(AppError);
    });

    it('should reject update for non-existent position', () => {
      expect(() => updatePosition(999, userId, { costPrice: 12 }, db)).toThrow(AppError);
    });

    it('should reject update for another user\'s position', async () => {
      const otherUserId = createTestUser(db, 'otheruser');
      const created = await createPosition(otherUserId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      expect(() => updatePosition(created.id, userId, { costPrice: 12 }, db)).toThrow(AppError);
    });
  });

  describe('deletePosition', () => {
    it('should delete an existing position', async () => {
      const created = await createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      const result = deletePosition(created.id, userId, db);
      expect(result).toBe(true);

      const found = getPositionById(created.id, userId, db);
      expect(found).toBeNull();
    });

    it('should throw for non-existent position', () => {
      expect(() => deletePosition(999, userId, db)).toThrow(AppError);
    });

    it('should not delete another user\'s position', async () => {
      const otherUserId = createTestUser(db, 'otheruser');
      const created = await createPosition(otherUserId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      expect(() => deletePosition(created.id, userId, db)).toThrow(AppError);
    });
  });
});
