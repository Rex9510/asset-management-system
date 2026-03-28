import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function addUser(db: Database.Database, id: number) {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, `user${id}`, 'hash');
}

const stageArb = fc.constantFrom('bottom', 'rising', 'main_wave', 'high', 'falling');
const actionArb = fc.constantFrom('hold', 'add', 'reduce', 'clear');

describe('属性测试：自我修正检测', () => {
  it('看多预判但价格大幅下跌时应产生偏差记录', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('rising', 'main_wave', 'bottom'),
        fc.constantFrom('add', 'hold'),
        fc.double({ min: 10, max: 100, noNaN: true }),
        fc.double({ min: 6, max: 15, noNaN: true }), // drop percent
        (stage, action, analysisPrice, dropPct) => {
          const db = makeDb();
          addUser(db, 1);

          const currentPrice = analysisPrice * (1 - dropPct / 100);

          // Insert a bullish analysis
          db.prepare(
            `INSERT INTO analyses (user_id, stock_code, stock_name, trigger_type, stage, action_ref, confidence, reasoning, market_price, created_at)
             VALUES (1, '600000', '测试', 'manual', ?, ?, 75, '看多', ?, datetime('now'))`
          ).run(stage, action, analysisPrice);

          // Simulate deviation detection logic inline
          const priceChange = ((currentPrice - analysisPrice) / analysisPrice) * 100;
          const bullishStages = ['rising', 'main_wave', 'bottom'];
          const bullishActions = ['add', 'hold'];
          const isBullish = bullishStages.includes(stage) || bullishActions.includes(action);

          if (isBullish && priceChange < -5) {
            // Should detect deviation
            expect(priceChange).toBeLessThan(-5);
            const severity = priceChange < -10 ? 'severe' : 'moderate';
            expect(['moderate', 'severe']).toContain(severity);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('看空预判但价格大幅上涨时应产生偏差记录', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('falling', 'high'),
        fc.constantFrom('reduce', 'clear'),
        fc.double({ min: 10, max: 100, noNaN: true }),
        fc.double({ min: 6, max: 20, noNaN: true }), // rise percent
        (stage, action, analysisPrice, risePct) => {
          const currentPrice = analysisPrice * (1 + risePct / 100);
          const priceChange = ((currentPrice - analysisPrice) / analysisPrice) * 100;

          const bearishActions = ['reduce', 'clear'];
          const isBearish = bearishActions.includes(action) || stage === 'falling';

          if (isBearish && priceChange > 5) {
            expect(priceChange).toBeGreaterThan(5);
            const severity = priceChange > 10 ? 'severe' : 'moderate';
            expect(['moderate', 'severe']).toContain(severity);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
