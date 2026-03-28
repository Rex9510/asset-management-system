/**
 * 通知设置属性测试
 * Task 20.2
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { getNotificationSettings, updateNotificationSettings, isNotificationEnabled } from './notificationService';
import { initializeDatabase } from '../db/init';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  initializeDatabase(db);
  db.prepare("INSERT INTO users (id, username, password_hash, last_login_at) VALUES (1, 'u1', 'h', datetime('now'))").run();
  return db;
}

const MESSAGE_TYPES = [
  'analysis', 'stop_loss_alert', 'rotation_switch', 'chain_activation',
  'event_window', 'cycle_bottom', 'market_env_change', 'daily_pick_tracking',
  'concentration_risk', 'deep_report', 'ambush', 'target_price',
];

// Feature: ai-investment-assistant-phase2, Property 32: 通知设置过滤
// 验证需求：14.2, 14.3
test('关闭某类型通知时 isNotificationEnabled 返回 false，但消息中心仍可存储', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...MESSAGE_TYPES),
      fc.boolean(),
      (messageType, enabled) => {
        const db = setupDb();

        updateNotificationSettings(1, [{ messageType, enabled }], db);

        const result = isNotificationEnabled(1, messageType, db);
        expect(result).toBe(enabled);

        // Verify message can still be inserted regardless of notification setting
        db.prepare(
          `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read)
           VALUES (1, ?, '600000', 'test', 'test summary', '{}', 0)`
        ).run(messageType);

        const msg = db.prepare(
          "SELECT * FROM messages WHERE user_id = 1 AND type = ?"
        ).get(messageType) as { type: string } | undefined;
        expect(msg).toBeDefined();

        db.close();
      }
    ),
    { numRuns: 24 }
  );
});

// Additional: default settings are all enabled
test('默认通知设置全部开启', () => {
  const db = setupDb();
  const settings = getNotificationSettings(1, db);

  for (const s of settings) {
    expect(s.enabled).toBe(true);
  }

  db.close();
});

// Additional: round-trip update
test('通知设置更新后读取一致', () => {
  const db = setupDb();

  updateNotificationSettings(1, [
    { messageType: 'stop_loss_alert', enabled: false },
    { messageType: 'cycle_bottom', enabled: false },
  ], db);

  const settings = getNotificationSettings(1, db);
  const stopLoss = settings.find(s => s.messageType === 'stop_loss_alert');
  const cycle = settings.find(s => s.messageType === 'cycle_bottom');

  expect(stopLoss!.enabled).toBe(false);
  expect(cycle!.enabled).toBe(false);

  // Others remain enabled
  const rotation = settings.find(s => s.messageType === 'rotation_switch');
  expect(rotation!.enabled).toBe(true);

  db.close();
});
