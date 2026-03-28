import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { Errors } from '../errors/AppError';

// --- Types ---

export interface MessageRow {
  id: number;
  user_id: number;
  type: string;
  stock_code: string;
  stock_name: string;
  summary: string;
  detail: string;
  analysis_id: number | null;
  is_read: number;
  created_at: string;
}

export interface MessageResponse {
  id: number;
  userId: number;
  type: string;
  stockCode: string;
  stockName: string;
  summary: string;
  detail: string;
  analysisId: number | null;
  isRead: boolean;
  createdAt: string;
}

export interface GetMessagesOptions {
  type?: string;
  page?: number;
  limit?: number;
}

export interface GetMessagesResult {
  messages: MessageResponse[];
  total: number;
  hasMore: boolean;
}

const VALID_TYPES = [
  'scheduled_analysis',
  'volatility_alert',
  'self_correction',
  'daily_pick',
  'target_price_alert',
  'ambush_recommendation',
  'stop_loss_alert',
  'rotation_switch',
  'chain_activation',
  'event_window',
  'cycle_bottom',
  'market_env_change',
  'daily_pick_tracking',
  'concentration_risk',
  'deep_report',
];

// --- Helpers ---

function toResponse(row: MessageRow): MessageResponse {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    summary: row.summary,
    detail: row.detail,
    analysisId: row.analysis_id,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
  };
}

// --- Service functions ---

export function getMessages(
  userId: number,
  options: GetMessagesOptions = {},
  db?: Database.Database
): GetMessagesResult {
  const database = db || getDatabase();
  const { type, page = 1, limit = 20 } = options;

  const types = type ? type.split(',').map(t => t.trim()).filter(Boolean) : [];
  for (const t of types) {
    if (!VALID_TYPES.includes(t)) {
      throw Errors.badRequest(`无效的消息类型: ${t}`);
    }
  }

  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const offset = (safePage - 1) * safeLimit;

  let countSql = 'SELECT COUNT(*) as total FROM messages WHERE user_id = ?';
  let querySql = 'SELECT * FROM messages WHERE user_id = ?';
  const params: (number | string)[] = [userId];

  if (types.length === 1) {
    countSql += ' AND type = ?';
    querySql += ' AND type = ?';
    params.push(types[0]);
  } else if (types.length > 1) {
    const placeholders = types.map(() => '?').join(',');
    countSql += ` AND type IN (${placeholders})`;
    querySql += ` AND type IN (${placeholders})`;
    params.push(...types);
  }

  querySql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

  const { total } = database.prepare(countSql).get(...params) as { total: number };
  const rows = database.prepare(querySql).all(...params, safeLimit, offset) as MessageRow[];

  return {
    messages: rows.map(toResponse),
    total,
    hasMore: offset + rows.length < total,
  };
}

export function getMessageById(
  userId: number,
  messageId: number,
  db?: Database.Database
): MessageResponse | null {
  const database = db || getDatabase();

  const row = database.prepare(
    'SELECT * FROM messages WHERE id = ? AND user_id = ?'
  ).get(messageId, userId) as MessageRow | undefined;

  if (!row) {
    return null;
  }

  // Mark as read
  if (row.is_read === 0) {
    database.prepare(
      'UPDATE messages SET is_read = 1 WHERE id = ?'
    ).run(messageId);
  }

  return toResponse({ ...row, is_read: 1 });
}

export function getUnreadCount(
  userId: number,
  db?: Database.Database
): number {
  const database = db || getDatabase();

  const result = database.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND is_read = 0'
  ).get(userId) as { count: number };

  return result.count;
}
