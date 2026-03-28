import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';

// --- Types ---

export interface NotificationSetting {
  messageType: string;
  enabled: boolean;
  label: string;
}

// --- Constants ---

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  analysis: 'AI分析完成',
  stop_loss_alert: '止损提醒',
  rotation_switch: '板块轮动切换',
  chain_activation: '传导链节点激活',
  event_window: '事件窗口期变化',
  cycle_bottom: '周期底部信号',
  market_env_change: '大盘环境变化',
  daily_pick_tracking: '每日关注追踪',
  concentration_risk: '持仓集中度风险',
  deep_report: '深度报告完成',
  ambush: '埋伏推荐',
  target_price: '目标价提醒',
};

// --- Service functions ---

export function getDefaultSettings(): NotificationSetting[] {
  return Object.entries(MESSAGE_TYPE_LABELS).map(([messageType, label]) => ({
    messageType,
    enabled: true,
    label,
  }));
}

export function getNotificationSettings(
  userId: number,
  db?: Database.Database
): NotificationSetting[] {
  const database = db || getDatabase();

  const rows = database.prepare(
    'SELECT message_type, enabled FROM notification_settings WHERE user_id = ?'
  ).all(userId) as Array<{ message_type: string; enabled: number }>;

  const savedMap = new Map(rows.map((r) => [r.message_type, r.enabled === 1]));

  return Object.entries(MESSAGE_TYPE_LABELS).map(([messageType, label]) => ({
    messageType,
    enabled: savedMap.has(messageType) ? savedMap.get(messageType)! : true,
    label,
  }));
}


export function updateNotificationSettings(
  userId: number,
  settings: Array<{ messageType: string; enabled: boolean }>,
  db?: Database.Database
): void {
  const database = db || getDatabase();

  const stmt = database.prepare(
    'INSERT OR REPLACE INTO notification_settings (user_id, message_type, enabled) VALUES (?, ?, ?)'
  );

  const runAll = database.transaction(() => {
    for (const s of settings) {
      stmt.run(userId, s.messageType, s.enabled ? 1 : 0);
    }
  });

  runAll();
}

export function isNotificationEnabled(
  userId: number,
  messageType: string,
  db?: Database.Database
): boolean {
  const database = db || getDatabase();

  const row = database.prepare(
    'SELECT enabled FROM notification_settings WHERE user_id = ? AND message_type = ?'
  ).get(userId, messageType) as { enabled: number } | undefined;

  if (!row) {
    return true; // default enabled
  }

  return row.enabled === 1;
}
