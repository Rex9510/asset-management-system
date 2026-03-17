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
    it('should create a holding position with valid data', () => {
      const position = createPosition(userId, {
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

    it('should create a watching position with only code and name', () => {
      const position = createPosition(userId, {
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

    it('should default to holding type when positionType not specified', () => {
      const position = createPosition(userId, {
        stockCode: '600000',
        stockName: '浦发银行',
        costPrice: 10,
        shares: 100,
        buyDate: '2024-01-15',
      }, db);
      expect(position.positionType).toBe('holding');
    });

    it('should reject invalid stock code', () => {
      expect(() =>
        createPosition(userId, {
          stockCode: '999999',
          stockName: '测试',
          costPrice: 10,
          shares: 100,
          buyDate: '2024-01-15',
        }, db)
      ).toThrow(AppError);
    });

    it('should reject empty stock name', () => {
      expect(() =>
        createPosition(userId, {
          stockCode: '600000',
          stockName: '',
          costPrice: 10,
          shares: 100,
          buyDate: '2024-01-15',
        }, db)
      ).toThrow(AppError);
    });

    it('should reject non-positive cost price for holding', () => {
      expect(() =>
        createPosition(userId, {
          stockCode: '600000',
          stockName: '浦发银行',
          costPrice: 0,
          shares: 100,
          buyDate: '2024-01-15',
        }, db)
      ).toThrow(AppError);

      expect(() =>
        createPosition(userId, {
          stockCode: '600000',
          stockName: '浦发银行',
          costPrice: -5,
          shares: 100,
          buyDate: '2024-01-15',
        }, db)
      ).toThrow(AppError);
    });

    it('should reject non-positive-integer shares for holding', () => {
      expect(() =>
        createPosition(userId, {
          stockCode: '600000',
          stockName: '浦发银行',
          costPrice: 10,
          shares: 0,
          buyDate: '2024-01-15',
        }, db)
      ).toThrow(AppError);

      expect(() =>
        createPosition(userId, {
          stockCode: '600000',
          stockName: '浦发银行',
          costPrice: 10,
          shares: 1.5,
          buyDate: '2024-01-15',
        }, db)
      ).toThrow(AppError);
    });

    it('should reject invalid buy date for holding', () => {
      expect(() =>
        createPosition(userId, {
          stockCode: '600000',
          stockName: '浦发银行',
          costPrice: 10,
          shares: 100,
          buyDate: 'not-a-date',
        }, db)
      ).toThrow(AppError);
    });

    it('should not require cost/shares/date for watching', () => {
      const position = createPosition(userId, {
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

  describe('getPositions', () => {
    it('should return empty array when no positions', () => {
      const positions = getPositions(userId, db);
      expect(positions).toEqual([]);
    });

    it('should return all positions for a user', () => {
      createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      createPosition(userId, { stockCode: '000001', stockName: '平安银行', costPrice: 12, shares: 200, buyDate: '2024-02-01' }, db);

      const positions = getPositions(userId, db);
      expect(positions).toHaveLength(2);
    });

    it('should filter by type', () => {
      createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      createPosition(userId, { stockCode: '000001', stockName: '平安银行', positionType: 'watching' }, db);

      const holdings = getPositions(userId, db, 'holding');
      expect(holdings).toHaveLength(1);
      expect(holdings[0].positionType).toBe('holding');

      const watchings = getPositions(userId, db, 'watching');
      expect(watchings).toHaveLength(1);
      expect(watchings[0].positionType).toBe('watching');
    });

    it('should not return positions of other users', () => {
      const otherUserId = createTestUser(db, 'otheruser');
      createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      createPosition(otherUserId, { stockCode: '000001', stockName: '平安银行', costPrice: 12, shares: 200, buyDate: '2024-02-01' }, db);

      const positions = getPositions(userId, db);
      expect(positions).toHaveLength(1);
      expect(positions[0].stockCode).toBe('600000');
    });

    it('should include current price and P&L when market_cache has data', () => {
      createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      db.prepare('INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES (?, ?, ?, ?)').run('600000', '浦发银行', 15, 5.0);

      const positions = getPositions(userId, db);
      expect(positions[0].currentPrice).toBe(15);
      expect(positions[0].profitLoss).toBe(500);
      expect(positions[0].profitLossPercent).toBe(50);
    });

    it('should not calculate P&L for watching positions', () => {
      createPosition(userId, { stockCode: '600000', stockName: '浦发银行', positionType: 'watching' }, db);
      db.prepare('INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES (?, ?, ?, ?)').run('600000', '浦发银行', 15, 5.0);

      const positions = getPositions(userId, db);
      expect(positions[0].currentPrice).toBe(15);
      expect(positions[0].profitLoss).toBeNull();
      expect(positions[0].profitLossPercent).toBeNull();
    });
  });

  describe('updatePosition', () => {
    it('should update cost price', () => {
      const created = createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      const updated = updatePosition(created.id, userId, { costPrice: 12 }, db);
      expect(updated.costPrice).toBe(12);
      expect(updated.shares).toBe(100);
    });

    it('should update shares', () => {
      const created = createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      const updated = updatePosition(created.id, userId, { shares: 200 }, db);
      expect(updated.shares).toBe(200);
      expect(updated.costPrice).toBe(10);
    });

    it('should reject update with no fields', () => {
      const created = createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      expect(() => updatePosition(created.id, userId, {}, db)).toThrow(AppError);
    });

    it('should reject update for non-existent position', () => {
      expect(() => updatePosition(999, userId, { costPrice: 12 }, db)).toThrow(AppError);
    });

    it('should reject update for another user\'s position', () => {
      const otherUserId = createTestUser(db, 'otheruser');
      const created = createPosition(otherUserId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      expect(() => updatePosition(created.id, userId, { costPrice: 12 }, db)).toThrow(AppError);
    });
  });

  describe('deletePosition', () => {
    it('should delete an existing position', () => {
      const created = createPosition(userId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      const result = deletePosition(created.id, userId, db);
      expect(result).toBe(true);

      const found = getPositionById(created.id, userId, db);
      expect(found).toBeNull();
    });

    it('should throw for non-existent position', () => {
      expect(() => deletePosition(999, userId, db)).toThrow(AppError);
    });

    it('should not delete another user\'s position', () => {
      const otherUserId = createTestUser(db, 'otheruser');
      const created = createPosition(otherUserId, { stockCode: '600000', stockName: '浦发银行', costPrice: 10, shares: 100, buyDate: '2024-01-15' }, db);
      expect(() => deletePosition(created.id, userId, db)).toThrow(AppError);
    });
  });
});
