/**
 * 变化触发制和去重池单元测试
 * Task 3.4
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { hasSignificantChange, updateSnapshot, clearSnapshotCache } from './changeDetector';
import { getDeduplicatedStocks } from './stockDeduplicator';
import { initializeDatabase } from '../db/init';

beforeEach(() => {
  clearSnapshotCache();
});

// Feature: ai-investment-assistant-phase2, Property: 变化触发制 — 小变化跳过
// 验证需求：降本优化
test('价格变化 < 2% 且 RSI 变化 < 5 时跳过AI', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 1, max: 1000, noNaN: true }),
      fc.double({ min: 0, max: 1.99, noNaN: true }),   // priceChangePct < 2%
      fc.double({ min: 0, max: 4.99, noNaN: true }),   // rsiChange < 5
      fc.double({ min: 10, max: 90, noNaN: true }),     // baseRsi
      (basePrice, priceChangePct, rsiChange, baseRsi) => {
        const stockCode = 'TEST01';
        updateSnapshot(stockCode, basePrice, baseRsi);

        const newPrice = basePrice * (1 + priceChangePct / 100);
        const newRsi = baseRsi + rsiChange;

        // Both changes are small → should NOT have significant change
        return hasSignificantChange(stockCode, newPrice, newRsi) === false;
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: ai-investment-assistant-phase2, Property: 变化触发制 — 首次分析
// 验证需求：降本优化
test('无快照时（首次分析）始终返回 true', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 1, max: 1000, noNaN: true }),
      fc.double({ min: 0, max: 100, noNaN: true }),
      (price, rsi) => {
        const code = `FIRST_${Math.random().toString(36).slice(2, 8)}`;
        return hasSignificantChange(code, price, rsi) === true;
      }
    ),
    { numRuns: 50 }
  );
});

// Feature: ai-investment-assistant-phase2, Property: 股票去重 — 同一股票多用户只分析一次
// 验证需求：降本优化
test('同一股票多用户只出现一次在去重列表中', () => {
  const db = new Database(':memory:');
  initializeDatabase(db);

  // Create multiple users holding the same stock
  const userCount = 5;
  for (let i = 1; i <= userCount; i++) {
    db.prepare(
      "INSERT INTO users (id, username, password_hash, last_login_at) VALUES (?, ?, 'hash', datetime('now'))"
    ).run(i, `user${i}`);
    db.prepare(
      "INSERT INTO positions (user_id, stock_code, stock_name, position_type, shares) VALUES (?, '600000', '浦发银行', 'holding', 100)"
    ).run(i);
  }

  const result = getDeduplicatedStocks(db);
  const stock600000 = result.filter(s => s.stockCode === '600000');

  expect(stock600000).toHaveLength(1);
  expect(stock600000[0].holderUserIds).toHaveLength(userCount);

  db.close();
});
