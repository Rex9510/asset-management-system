import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  getDefaultSettings,
  getNotificationSettings,
  updateNotificationSettings,
  isNotificationEnabled,
  NotificationSetting,
} from './notificationService';

let testDb: Database.Database;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function insertUser(db: Database.Database, userId: number): void {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(userId, `user${userId}`, 'hash');
}

beforeEach(() => {
  testDb = makeDb();
  insertUser(testDb, 1);
});

afterEach(() => {
  testDb.close();
});

// --- getDefaultSettings ---

describe('getDefaultSettings', () => {
  it('should return all 12 message types', () => {
    const defaults = getDefaultSettings();
    expect(defaults).toHaveLength(12);
  });

  it('should have all types enabled by default', () => {
    const defaults = getDefaultSettings();
    expect(defaults.every((s) => s.enabled === true)).toBe(true);
  });

  it('should include correct labels', () => {
    const defaults = getDefaultSettings();
    const map = new Map(defaults.map((s) => [s.messageType, s.label]));
    expect(map.get('analysis')).toBe('AI分析完成');
    expect(map.get('stop_loss_alert')).toBe('止损提醒');
    expect(map.get('rotation_switch')).toBe('板块轮动切换');
    expect(map.get('chain_activation')).toBe('传导链节点激活');
    expect(map.get('event_window')).toBe('事件窗口期变化');
    expect(map.get('cycle_bottom')).toBe('周期底部信号');
    expect(map.get('market_env_change')).toBe('大盘环境变化');
    expect(map.get('daily_pick_tracking')).toBe('每日关注追踪');
    expect(map.get('concentration_risk')).toBe('持仓集中度风险');
    expect(map.get('deep_report')).toBe('深度报告完成');
    expect(map.get('ambush')).toBe('埋伏推荐');
    expect(map.get('target_price')).toBe('目标价提醒');
  });
});


// --- getNotificationSettings ---

describe('getNotificationSettings', () => {
  it('should return defaults when no settings exist', () => {
    const settings = getNotificationSettings(1, testDb);
    expect(settings).toHaveLength(12);
    expect(settings.every((s) => s.enabled === true)).toBe(true);
    // Each setting should have a label
    expect(settings.every((s) => s.label.length > 0)).toBe(true);
  });

  it('should reflect saved settings', () => {
    testDb.prepare(
      'INSERT INTO notification_settings (user_id, message_type, enabled) VALUES (?, ?, ?)'
    ).run(1, 'analysis', 0);

    const settings = getNotificationSettings(1, testDb);
    const analysis = settings.find((s) => s.messageType === 'analysis');
    expect(analysis).toBeDefined();
    expect(analysis!.enabled).toBe(false);

    // Other types still default to true
    const stopLoss = settings.find((s) => s.messageType === 'stop_loss_alert');
    expect(stopLoss!.enabled).toBe(true);
  });

  it('should not leak settings between users', () => {
    insertUser(testDb, 2);
    testDb.prepare(
      'INSERT INTO notification_settings (user_id, message_type, enabled) VALUES (?, ?, ?)'
    ).run(1, 'analysis', 0);

    const user2Settings = getNotificationSettings(2, testDb);
    const analysis = user2Settings.find((s) => s.messageType === 'analysis');
    expect(analysis!.enabled).toBe(true);
  });
});

// --- updateNotificationSettings ---

describe('updateNotificationSettings', () => {
  it('should create new settings', () => {
    updateNotificationSettings(1, [
      { messageType: 'analysis', enabled: false },
      { messageType: 'ambush', enabled: false },
    ], testDb);

    const settings = getNotificationSettings(1, testDb);
    const analysis = settings.find((s) => s.messageType === 'analysis');
    const ambush = settings.find((s) => s.messageType === 'ambush');
    expect(analysis!.enabled).toBe(false);
    expect(ambush!.enabled).toBe(false);
  });

  it('should update existing settings', () => {
    updateNotificationSettings(1, [{ messageType: 'analysis', enabled: false }], testDb);
    expect(isNotificationEnabled(1, 'analysis', testDb)).toBe(false);

    updateNotificationSettings(1, [{ messageType: 'analysis', enabled: true }], testDb);
    expect(isNotificationEnabled(1, 'analysis', testDb)).toBe(true);
  });

  it('should handle empty settings array', () => {
    updateNotificationSettings(1, [], testDb);
    const settings = getNotificationSettings(1, testDb);
    expect(settings.every((s) => s.enabled === true)).toBe(true);
  });
});

// --- isNotificationEnabled ---

describe('isNotificationEnabled', () => {
  it('should return true by default when no setting exists', () => {
    expect(isNotificationEnabled(1, 'analysis', testDb)).toBe(true);
    expect(isNotificationEnabled(1, 'stop_loss_alert', testDb)).toBe(true);
    expect(isNotificationEnabled(1, 'unknown_type', testDb)).toBe(true);
  });

  it('should return false when disabled', () => {
    updateNotificationSettings(1, [{ messageType: 'analysis', enabled: false }], testDb);
    expect(isNotificationEnabled(1, 'analysis', testDb)).toBe(false);
  });

  it('should return true when explicitly enabled', () => {
    updateNotificationSettings(1, [{ messageType: 'analysis', enabled: true }], testDb);
    expect(isNotificationEnabled(1, 'analysis', testDb)).toBe(true);
  });

  it('should be user-scoped', () => {
    insertUser(testDb, 2);
    updateNotificationSettings(1, [{ messageType: 'analysis', enabled: false }], testDb);

    expect(isNotificationEnabled(1, 'analysis', testDb)).toBe(false);
    expect(isNotificationEnabled(2, 'analysis', testDb)).toBe(true);
  });
});
