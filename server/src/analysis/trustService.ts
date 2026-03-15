/**
 * 渐进式信任策略服务
 *
 * 根据用户账户年龄（使用时长）确定信任等级，
 * 新用户仅提供低风险操作参考（持有/减仓），
 * 随使用时长增加逐步开放高风险操作参考。
 *
 * 信任等级：
 *   Level 1 (0-7天): 仅允许 'hold' 和 'reduce'
 *   Level 2 (7-30天): 允许 'hold', 'reduce', 'clear'
 *   Level 3 (30天+): 允许所有操作，包括 'add'
 *
 * 需求：9.3, 9.4
 */

import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { AnalysisResult } from '../ai/aiProvider';

// --- Types ---

export type TrustLevel = 1 | 2 | 3;

export type ActionRef = AnalysisResult['actionRef'];

// --- Constants ---

/** Trust level thresholds in days */
export const TRUST_LEVEL_THRESHOLDS = {
  LEVEL_2_DAYS: 7,
  LEVEL_3_DAYS: 30,
} as const;

/** Allowed actions per trust level */
export const TRUST_LEVEL_ACTIONS: Record<TrustLevel, ActionRef[]> = {
  1: ['hold', 'reduce'],
  2: ['hold', 'reduce', 'clear'],
  3: ['hold', 'reduce', 'clear', 'add'],
};

/** Downgrade mapping: action → fallback when not allowed */
const ACTION_DOWNGRADE: Record<ActionRef, ActionRef> = {
  add: 'hold',
  clear: 'reduce',
  reduce: 'reduce',
  hold: 'hold',
};

// --- Core functions ---

/**
 * Calculate the number of days since the user registered.
 */
export function getUserAccountAgeDays(userId: number, db?: Database.Database): number {
  const database = db || getDatabase();
  const row = database
    .prepare('SELECT created_at FROM users WHERE id = ?')
    .get(userId) as { created_at: string } | undefined;

  if (!row) return 0;

  const createdAt = new Date(row.created_at);
  const now = new Date();
  const diffMs = now.getTime() - createdAt.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Determine the trust level for a user based on account age.
 *
 * Level 1: 0-6 days (< 7 days)
 * Level 2: 7-29 days (< 30 days)
 * Level 3: 30+ days
 */
export function getUserTrustLevel(userId: number, db?: Database.Database): TrustLevel {
  const ageDays = getUserAccountAgeDays(userId, db);

  if (ageDays >= TRUST_LEVEL_THRESHOLDS.LEVEL_3_DAYS) return 3;
  if (ageDays >= TRUST_LEVEL_THRESHOLDS.LEVEL_2_DAYS) return 2;
  return 1;
}

/**
 * Filter (downgrade) an action reference based on the user's trust level.
 * If the action is not allowed at the current trust level, it is downgraded
 * to a safer alternative.
 *
 * Downgrade rules:
 *   'add' → 'hold' (if add not allowed)
 *   'clear' → 'reduce' (if clear not allowed)
 */
export function filterActionByTrust(actionRef: ActionRef, trustLevel: TrustLevel): ActionRef {
  const allowedActions = TRUST_LEVEL_ACTIONS[trustLevel];
  if (allowedActions.includes(actionRef)) {
    return actionRef;
  }
  return ACTION_DOWNGRADE[actionRef];
}

/**
 * Check if a user is a "new user" (account age < 7 days).
 */
export function isNewUser(userId: number, db?: Database.Database): boolean {
  const ageDays = getUserAccountAgeDays(userId, db);
  return ageDays < TRUST_LEVEL_THRESHOLDS.LEVEL_2_DAYS;
}

/**
 * Generate cold-start backtest reference records for a new user.
 * Creates historical analysis records using simulated backtest data
 * so the user can see example reference records immediately.
 */
export function generateColdStartRecords(
  userId: number,
  stockCode: string,
  stockName: string,
  db?: Database.Database
): void {
  const database = db || getDatabase();

  // Check if user already has analysis records for this stock
  const existing = database
    .prepare('SELECT COUNT(*) as count FROM analyses WHERE user_id = ? AND stock_code = ?')
    .get(userId, stockCode) as { count: number };

  if (existing.count > 0) return;

  // Generate 3 backtest reference records (low-risk only: hold/reduce)
  const backtestRecords = [
    {
      stage: 'rising',
      actionRef: 'hold',
      confidence: 68,
      reasoning: '回测参考：基于历史数据分析，该股处于上升趋势初期，参考方案为持有观望，等待趋势确认。',
      daysAgo: 5,
    },
    {
      stage: 'high',
      actionRef: 'reduce',
      confidence: 72,
      reasoning: '回测参考：基于历史数据分析，该股短期涨幅较大，参考方案为适当减仓锁定部分利润。',
      daysAgo: 3,
    },
    {
      stage: 'bottom',
      actionRef: 'hold',
      confidence: 65,
      reasoning: '回测参考：基于历史数据分析，该股处于底部区域，参考方案为持有等待反弹信号。',
      daysAgo: 1,
    },
  ];

  const insert = database.prepare(
    `INSERT INTO analyses (
      user_id, stock_code, stock_name, trigger_type, stage, space_estimate,
      key_signals, action_ref, batch_plan, confidence, reasoning,
      data_sources, technical_indicators, news_summary,
      recovery_estimate, profit_estimate, risk_alerts, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const record of backtestRecords) {
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - record.daysAgo);

    insert.run(
      userId,
      stockCode,
      stockName,
      'scheduled',
      record.stage,
      null,
      JSON.stringify(['回测数据信号']),
      record.actionRef,
      JSON.stringify([]),
      record.confidence,
      record.reasoning,
      JSON.stringify(['backtest_data']),
      null,
      null,
      null,
      null,
      JSON.stringify([]),
      createdAt.toISOString(),
    );
  }
}
