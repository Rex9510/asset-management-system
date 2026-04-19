import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  createPosition,
  getPositions,
  getPositionById,
  deletePosition,
  isValidStockCode,
  calculateProfitLoss,
  calculateProfitLossPercent,
  calculateHoldingDays,
} from './positionService';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function addUser(db: Database.Database, id: number) {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, `user${id}`, 'hash');
}

// Valid A-share stock code prefixes
const validPrefixes = ['600', '601', '603', '605', '000', '001', '002', '003', '300', '301', '688', '689'];
const validStockCode = fc.constantFrom(...validPrefixes).chain(prefix =>
  fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 3, maxLength: 3 }).map(suffix => prefix + suffix)
);

const validStockName = fc.stringOf(fc.constantFrom(...'测试股票名称甲乙丙丁'.split('')), { minLength: 2, maxLength: 6 });
const validCostPrice = fc.double({ min: 0.01, max: 9999, noNaN: true }).map(v => Math.round(v * 100) / 100);
const validShares = fc.integer({ min: 1, max: 100000 });
const validBuyDate = fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }).map(d => d.toISOString().split('T')[0]);

describe('属性测试：持仓 CRUD 往返', () => {
  it('对任意有效持仓数据，创建后查询应返回相同数据', async () => {
    await fc.assert(
      fc.asyncProperty(validStockCode, validStockName, validCostPrice, validShares, validBuyDate,
        async (stockCode, stockName, costPrice, shares, buyDate) => {
          const db = makeDb();
          addUser(db, 1);
          const created = await createPosition(1, { stockCode, stockName, positionType: 'holding', costPrice, shares, buyDate }, db);
          expect(created.stockCode).toBe(stockCode);
          expect(created.stockName).toBe(stockName);
          expect(created.costPrice).toBe(costPrice);
          expect(created.shares).toBe(shares);
          expect(created.positionType).toBe('holding');

          const fetched = getPositionById(created.id, 1, db);
          expect(fetched).not.toBeNull();
          expect(fetched!.stockCode).toBe(stockCode);
          expect(fetched!.costPrice).toBe(costPrice);
          expect(fetched!.shares).toBe(shares);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('属性测试：无效股票代码拒绝', () => {
  it('对任意非A股代码，创建持仓应被拒绝', async () => {
    // Generate codes that don't match valid prefixes
    const invalidCode = fc.string({ minLength: 1, maxLength: 10 }).filter(s => !isValidStockCode(s));
    await fc.assert(
      fc.asyncProperty(invalidCode, async (code) => {
        const db = makeDb();
        addUser(db, 1);
        await expect(
          createPosition(1, { stockCode: code, stockName: '测试', positionType: 'holding', costPrice: 10, shares: 100, buyDate: '2024-01-01' }, db)
        ).rejects.toThrow('股票代码无效');
      }),
      { numRuns: 100 }
    );
  });
});

describe('属性测试：盈亏计算正确性', () => {
  it('对任意成本价、份额、当前价，盈亏金额和比例应符合公式', () => {
    const posPrice = fc.double({ min: 0.01, max: 9999, noNaN: true }).map(v => Math.round(v * 100) / 100);
    fc.assert(
      fc.property(posPrice, validShares, posPrice, (costPrice, shares, currentPrice) => {
        const pl = calculateProfitLoss(costPrice, shares, currentPrice);
        const expectedPl = (currentPrice - costPrice) * shares;
        expect(Math.abs(pl - expectedPl)).toBeLessThan(0.01);

        const plPercent = calculateProfitLossPercent(costPrice, currentPrice);
        const expectedPercent = ((currentPrice - costPrice) / costPrice) * 100;
        expect(Math.abs(plPercent - expectedPercent)).toBeLessThan(0.001);
      }),
      { numRuns: 200 }
    );
  });
});

describe('属性测试：持仓删除完整性', () => {
  it('对任意已存在持仓，删除后查询应返回不存在', async () => {
    await fc.assert(
      fc.asyncProperty(validStockCode, validStockName, validCostPrice, validShares, validBuyDate,
        async (stockCode, stockName, costPrice, shares, buyDate) => {
          const db = makeDb();
          addUser(db, 1);
          const created = await createPosition(1, { stockCode, stockName, positionType: 'holding', costPrice, shares, buyDate }, db);
          deletePosition(created.id, 1, db);
          const fetched = getPositionById(created.id, 1, db);
          expect(fetched).toBeNull();
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('属性测试：持仓天数计算正确性', () => {
  it('对任意买入日期，持仓天数应等于自然日差值', () => {
    fc.assert(
      fc.property(validBuyDate, (buyDate) => {
        const days = calculateHoldingDays(buyDate);
        const buy = new Date(buyDate + 'T00:00:00Z');
        const now = new Date();
        const nowMidnight = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const expected = Math.floor((nowMidnight.getTime() - buy.getTime()) / (1000 * 60 * 60 * 24));
        expect(days).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });
});
