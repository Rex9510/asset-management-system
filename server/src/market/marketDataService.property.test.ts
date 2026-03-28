import * as fc from 'fast-check';
import {
  resetSourceState,
  getCurrentSource,
  getMarketPrefix,
  fetchFromEastMoney,
  fetchFromSina,
  fetchFromTencent,
  getQuote,
} from './marketDataService';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

// Mock axios
jest.mock('axios');
const axios = require('axios');

beforeEach(() => {
  resetSourceState();
  jest.clearAllMocks();
});

describe('属性测试：行情数据源故障切换', () => {
  it('当主数据源连续失败时，应切换到备用源并最终返回数据或缓存', async () => {
    const validCode = fc.constantFrom('600000', '000001', '300001', '688001');

    await fc.assert(
      fc.asyncProperty(
        validCode,
        fc.integer({ min: 0, max: 2 }), // which source succeeds (0=none, 1=second, 2=third)
        fc.double({ min: 1, max: 500, noNaN: true }),
        async (stockCode, successSource, price) => {
          resetSourceState();
          const db = makeDb();

          // Insert cache data as fallback
          db.prepare(
            `INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(stockCode, '测试', 10.0, 1.5, 100000, new Date().toISOString());

          let callCount = 0;
          axios.get.mockImplementation(() => {
            callCount++;
            if (successSource === 0) {
              return Promise.reject(new Error('timeout'));
            }
            if (callCount === successSource) {
              return Promise.resolve({
                data: {
                  data: {
                    f57: stockCode,
                    f58: '测试',
                    f43: Math.round(price * 100),
                    f170: 150,
                    f47: 100000,
                  },
                },
              });
            }
            return Promise.reject(new Error('timeout'));
          });

          const quote = await getQuote(stockCode, db);
          expect(quote).toBeDefined();
          expect(quote.stockCode).toBe(stockCode);
          expect(quote.price).toBeGreaterThan(0);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('getMarketPrefix 对任意6开头代码返回sh，其他返回sz', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('600000', '601398', '688001', '000001', '002230', '300750'),
        (code) => {
          const prefix = getMarketPrefix(code);
          if (code.startsWith('6')) {
            expect(prefix).toBe('sh');
          } else {
            expect(prefix).toBe('sz');
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
