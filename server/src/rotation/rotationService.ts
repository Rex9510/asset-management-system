/**
 * 板块轮动追踪服务
 *
 * 纯规则引擎，零AI调用。
 * 基于三只ETF（科技515000、有色512400、消费159928）近20日涨幅 + 成交量比综合得分判断阶段。
 * P1↔科技成长, P2↔周期品, P3↔消费白酒
 *
 * 综合得分 = change20d * 0.6 + (volumeRatio - 1) * 100 * 0.4
 */
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { fetchKlineFromTencent, KlineRow } from '../market/historyService';

// --- Types ---

export type Phase = 'P1' | 'P2' | 'P3';

export interface ETFMetrics {
  code: string;
  change20d: number;
  volumeRatio: number;
}

export interface RotationStatus {
  currentPhase: Phase;
  phaseLabel: string;
  etfPerformance: {
    tech: ETFMetrics;
    cycle: ETFMetrics;
    consumer: ETFMetrics;
  };
  previousPhase: Phase | null;
  switchedAt: string | null;
  updatedAt: string;
}

export interface ETFScoreResult {
  change20d: number;
  volumeRatio: number;
  score: number;
}

// --- Constants ---

const ETF_CONFIG = {
  tech:     { code: '515000', phase: 'P1' as Phase, label: '科技成长' },
  cycle:    { code: '512400', phase: 'P2' as Phase, label: '周期品' },
  consumer: { code: '159928', phase: 'P3' as Phase, label: '消费白酒' },
};

const PHASE_MAP: Record<Phase, string> = {
  P1: '科技成长',
  P2: '周期品',
  P3: '消费白酒',
};

// --- Helper: get K-line data from DB, fallback to Tencent API ---

function getKlineFromDb(stockCode: string, days: number, db: Database.Database): { close: number; volume: number; date: string }[] {
  const rows = db.prepare(
    `SELECT trade_date, close_price, volume FROM market_history
     WHERE stock_code = ? ORDER BY trade_date DESC LIMIT ?`
  ).all(stockCode, days) as { trade_date: string; close_price: number; volume: number }[];

  return rows.map(r => ({ close: r.close_price, volume: r.volume, date: r.trade_date }));
}

async function getKlineData(
  stockCode: string,
  days: number,
  db: Database.Database
): Promise<{ close: number; volume: number; date: string }[]> {
  // Try DB first
  const dbRows = getKlineFromDb(stockCode, days, db);
  if (dbRows.length >= days) {
    return dbRows;
  }

  // Fallback: fetch from Tencent API
  const now = new Date();
  const start = new Date();
  start.setDate(start.getDate() - Math.ceil(days * 1.8)); // extra buffer for non-trading days
  const startStr = start.toISOString().slice(0, 10);
  const endStr = now.toISOString().slice(0, 10);

  try {
    const klines = await fetchKlineFromTencent(stockCode, startStr, endStr);
    if (klines.length > 0) {
      const recent = klines.slice(-days);
      return recent.map(k => ({ close: k.close, volume: k.volume, date: k.tradeDate }));
    }
  } catch {
    // API failed, fall through
  }

  // Return whatever DB had
  return dbRows;
}

// --- Core functions ---

/**
 * Calculate composite score for a single ETF.
 * score = change20d * 0.6 + (volumeRatio - 1) * 100 * 0.4
 */
export async function calculateETFScore(
  stockCode: string,
  db?: Database.Database
): Promise<ETFScoreResult> {
  const database = db || getDatabase();

  // Need at least 20 days of data for change20d, and 20 days for volume averages
  const data = await getKlineData(stockCode, 25, database);

  if (data.length < 2) {
    return { change20d: 0, volumeRatio: 1, score: 0 };
  }

  // Data is in DESC order from DB, reverse for chronological
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

  // 20-day price change: (latest close - close 20 days ago) / close 20 days ago * 100
  const latestClose = sorted[sorted.length - 1].close;
  const idx20 = Math.max(0, sorted.length - 21);
  const close20dAgo = sorted[idx20].close;
  const change20d = close20dAgo > 0
    ? ((latestClose - close20dAgo) / close20dAgo) * 100
    : 0;

  // Volume ratio: recent 5-day avg volume / 20-day avg volume
  const recentVolumes = sorted.slice(-5).map(d => d.volume);
  const allVolumes = sorted.slice(-20).map(d => d.volume);

  const avg5 = recentVolumes.length > 0
    ? recentVolumes.reduce((s, v) => s + v, 0) / recentVolumes.length
    : 0;
  const avg20 = allVolumes.length > 0
    ? allVolumes.reduce((s, v) => s + v, 0) / allVolumes.length
    : 1;

  const volumeRatio = avg20 > 0 ? avg5 / avg20 : 1;

  // Composite score
  const score = change20d * 0.6 + (volumeRatio - 1) * 100 * 0.4;

  return {
    change20d: Math.round(change20d * 100) / 100,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    score: Math.round(score * 100) / 100,
  };
}

/**
 * Determine phase from scores. Highest score wins.
 */
export function determinePhase(scores: {
  tech: number;
  cycle: number;
  consumer: number;
}): { phase: Phase; label: string } {
  const entries: { key: string; phase: Phase; score: number }[] = [
    { key: 'tech', phase: 'P1', score: scores.tech },
    { key: 'cycle', phase: 'P2', score: scores.cycle },
    { key: 'consumer', phase: 'P3', score: scores.consumer },
  ];

  // Sort descending by score; on tie, keep original order (tech > cycle > consumer)
  entries.sort((a, b) => b.score - a.score);

  const winner = entries[0];
  return { phase: winner.phase, label: PHASE_MAP[winner.phase] };
}


/**
 * Get the latest rotation status from DB.
 */
export function getCurrentRotation(db?: Database.Database): RotationStatus | null {
  const database = db || getDatabase();

  const row = database.prepare(
    `SELECT * FROM rotation_status ORDER BY updated_at DESC LIMIT 1`
  ).get() as {
    id: number;
    current_phase: string;
    phase_label: string;
    tech_change_20d: number;
    tech_volume_ratio: number;
    cycle_change_20d: number;
    cycle_volume_ratio: number;
    consumer_change_20d: number;
    consumer_volume_ratio: number;
    previous_phase: string | null;
    switched_at: string | null;
    updated_at: string;
  } | undefined;

  if (!row) return null;

  return {
    currentPhase: row.current_phase as Phase,
    phaseLabel: row.phase_label,
    etfPerformance: {
      tech: { code: '515000', change20d: row.tech_change_20d, volumeRatio: row.tech_volume_ratio },
      cycle: { code: '512400', change20d: row.cycle_change_20d, volumeRatio: row.cycle_volume_ratio },
      consumer: { code: '159928', change20d: row.consumer_change_20d, volumeRatio: row.consumer_volume_ratio },
    },
    previousPhase: row.previous_phase as Phase | null,
    switchedAt: row.switched_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Create rotation_switch messages for all active users.
 */
function createSwitchMessages(
  previousPhase: Phase,
  previousLabel: string,
  currentPhase: Phase,
  currentLabel: string,
  etfPerformance: RotationStatus['etfPerformance'],
  db: Database.Database
): void {
  // Active users = logged in within last 24 hours
  const users = db.prepare(
    `SELECT id FROM users WHERE last_login_at > datetime('now', '-24 hours')`
  ).all() as { id: number }[];

  // If no users with last_login_at (e.g. column is null), get all users as fallback
  const targetUsers = users.length > 0
    ? users
    : db.prepare('SELECT id FROM users').all() as { id: number }[];

  if (targetUsers.length === 0) return;

  const summary = `板块轮动切换：${previousLabel} → ${currentLabel}`;
  const detail = JSON.stringify({
    previousPhase,
    previousLabel,
    currentPhase,
    currentLabel,
    etfPerformance,
  });
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read, created_at)
     VALUES (?, 'rotation_switch', '', '板块轮动', ?, ?, 0, ?)`
  );

  const insertAll = db.transaction(() => {
    for (const user of targetUsers) {
      stmt.run(user.id, summary, detail, now);
    }
  });

  insertAll();
}

/**
 * Main update function: calculate scores, determine phase, detect switch, persist.
 */
export async function updateRotationStatus(db?: Database.Database): Promise<RotationStatus> {
  const database = db || getDatabase();

  // Calculate scores for all 3 ETFs
  const [techResult, cycleResult, consumerResult] = await Promise.all([
    calculateETFScore(ETF_CONFIG.tech.code, database),
    calculateETFScore(ETF_CONFIG.cycle.code, database),
    calculateETFScore(ETF_CONFIG.consumer.code, database),
  ]);

  // Determine phase
  const { phase, label } = determinePhase({
    tech: techResult.score,
    cycle: cycleResult.score,
    consumer: consumerResult.score,
  });

  // Get previous status
  const previous = getCurrentRotation(database);
  const previousPhase = previous?.currentPhase ?? null;
  const phaseChanged = previousPhase !== null && previousPhase !== phase;

  const now = new Date().toISOString();
  const switchedAt = phaseChanged ? now : (previous?.switchedAt ?? null);

  // Insert new rotation status row
  database.prepare(
    `INSERT INTO rotation_status
     (current_phase, phase_label, tech_change_20d, tech_volume_ratio,
      cycle_change_20d, cycle_volume_ratio, consumer_change_20d, consumer_volume_ratio,
      previous_phase, switched_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    phase, label,
    techResult.change20d, techResult.volumeRatio,
    cycleResult.change20d, cycleResult.volumeRatio,
    consumerResult.change20d, consumerResult.volumeRatio,
    previousPhase, switchedAt, now
  );

  // Create switch messages if phase changed
  if (phaseChanged && previousPhase) {
    const previousLabel = PHASE_MAP[previousPhase];
    const etfPerformance = {
      tech: { code: '515000', change20d: techResult.change20d, volumeRatio: techResult.volumeRatio },
      cycle: { code: '512400', change20d: cycleResult.change20d, volumeRatio: cycleResult.volumeRatio },
      consumer: { code: '159928', change20d: consumerResult.change20d, volumeRatio: consumerResult.volumeRatio },
    };
    createSwitchMessages(previousPhase, previousLabel, phase, label, etfPerformance, database);
  }

  return {
    currentPhase: phase,
    phaseLabel: label,
    etfPerformance: {
      tech: { code: '515000', change20d: techResult.change20d, volumeRatio: techResult.volumeRatio },
      cycle: { code: '512400', change20d: cycleResult.change20d, volumeRatio: cycleResult.volumeRatio },
      consumer: { code: '159928', change20d: consumerResult.change20d, volumeRatio: consumerResult.volumeRatio },
    },
    previousPhase: previousPhase,
    switchedAt: switchedAt,
    updatedAt: now,
  };
}
