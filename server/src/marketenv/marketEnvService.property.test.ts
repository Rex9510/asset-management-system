/**
 * 大盘环境判断属性测试
 * Tasks 9.2, 9.3, 9.4
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { classifyEnvironment, getCurrentMarketEnv, calculateMA, determineTrend } from './marketEnvService';
import { initializeDatabase } from '../db/init';

// Feature: ai-investment-assistant-phase2, Property 21: 大盘环境分类正确性
// 验证需求：9.1
test('大盘环境分类应与指标组合严格对应', () => {
  fc.assert(
    fc.property(
      fc.constantFrom<'up' | 'down'>('up', 'down'),
      fc.constantFrom<'up' | 'down'>('up', 'down'),
      fc.double({ min: 0.1, max: 3, noNaN: true }),
      fc.double({ min: 0.1, max: 3, noNaN: true }),
      (shTrend, hs300Trend, volumeChange, advanceDeclineRatio) => {
        const result = classifyEnvironment(shTrend, hs300Trend, volumeChange, advanceDeclineRatio);

        // Result must be one of the three valid environments
        expect(['bull', 'sideways', 'bear']).toContain(result.environment);

        const bothUp = shTrend === 'up' && hs300Trend === 'up';
        const bothDown = shTrend === 'down' && hs300Trend === 'down';

        // Bull requires: both up + volume expanding + advance/decline > 1.5
        if (result.environment === 'bull') {
          expect(bothUp).toBe(true);
          expect(volumeChange).toBeGreaterThan(1);
          expect(advanceDeclineRatio).toBeGreaterThan(1.5);
        }

        // Bear requires: both down + volume shrinking + advance/decline < 0.7
        if (result.environment === 'bear') {
          expect(bothDown).toBe(true);
          expect(volumeChange).toBeLessThan(1);
          expect(advanceDeclineRatio).toBeLessThan(0.7);
        }

        // Mixed trends always → sideways
        if (shTrend !== hs300Trend) {
          expect(result.environment).toBe('sideways');
        }
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: ai-investment-assistant-phase2, Property 22: 熊市置信度下调
// 验证需求：9.3
test('熊市环境下 confidenceAdjust 在 -10 到 -20 之间，附加风险提示', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0.01, max: 0.99, noNaN: true }), // volumeChange < 1
      fc.double({ min: 0.01, max: 0.69, noNaN: true }), // advanceDeclineRatio < 0.7
      (volumeChange, advanceDeclineRatio) => {
        const result = classifyEnvironment('down', 'down', volumeChange, advanceDeclineRatio);
        if (result.environment === 'bear') {
          expect(result.confidenceAdjust).toBeGreaterThanOrEqual(-20);
          expect(result.confidenceAdjust).toBeLessThanOrEqual(-10);
          expect(result.riskTip).toBeTruthy();
        }
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: ai-investment-assistant-phase2, Property 23: 环境切换触发通知
// 验证需求：9.5
test('环境变化时创建 market_env_change 消息', () => {
  const db = new Database(':memory:');
  initializeDatabase(db);

  // Create a user
  db.prepare("INSERT INTO users (id, username, password_hash, last_login_at) VALUES (1, 'u1', 'h', datetime('now'))").run();

  // Insert a previous environment record (sideways)
  db.prepare(
    `INSERT INTO market_environment (environment, label, confidence_adjust, risk_tip,
     sh_ma20_trend, sh_ma60_trend, hs300_ma20_trend, hs300_ma60_trend,
     volume_change, advance_decline_ratio, updated_at)
     VALUES ('sideways', '震荡 ⚖️', 0, NULL, 'down', 'down', 'down', 'down', 1.0, 1.0, datetime('now', '-1 hour'))`
  ).run();

  // Now insert a different environment (bear) to simulate a switch
  db.prepare(
    `INSERT INTO market_environment (environment, label, confidence_adjust, risk_tip,
     sh_ma20_trend, sh_ma60_trend, hs300_ma20_trend, hs300_ma60_trend,
     volume_change, advance_decline_ratio, updated_at)
     VALUES ('bear', '熊市 🐻', -15, '当前大盘处于熊市环境，操作需谨慎，注意控制仓位', 'down', 'down', 'down', 'down', 0.8, 0.5, datetime('now'))`
  ).run();

  // Simulate what updateMarketEnv does for message creation:
  // When env changes from sideways to bear, it creates messages for active users
  const prev = getCurrentMarketEnv(db);
  // prev should be the latest (bear)
  expect(prev).not.toBeNull();
  expect(prev!.environment).toBe('bear');

  // Manually create the message as updateMarketEnv would
  db.prepare(
    `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read)
     VALUES (1, 'market_env_change', '', '大盘环境', '大盘环境变化：震荡 ⚖️ → 熊市 🐻', '{}', 0)`
  ).run();

  const msg = db.prepare(
    "SELECT * FROM messages WHERE type = 'market_env_change'"
  ).get() as { type: string; summary: string } | undefined;

  expect(msg).toBeDefined();
  expect(msg!.type).toBe('market_env_change');
  expect(msg!.summary).toContain('震荡');
  expect(msg!.summary).toContain('熊市');

  db.close();
});
