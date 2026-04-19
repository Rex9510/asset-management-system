/**
 * 商品传导链监控服务
 *
 * 纯规则引擎，零AI调用。
 * 监控7个商品ETF节点：黄金→白银→有色→煤炭→化工→橡胶→原油
 *
 * 规则摘要：
 * - 主排名：在约 3～5 年等价交易日（750～1250 根 K，按数据量择优）区间涨跌幅，7 节点横截面相对排名
 * - 辅提示：约 6 个月（120 交易日）涨跌幅，用于文案「短期动能」
 * - 数据不足：自动缩短主窗口并在 windowNote 明示
 * - 状态滞回：与上次已落库状态不一致时，需连续 2 次运行得到相同「原始排名状态」才切换展示状态（减轻抖动）
 */
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { fetchKlineFromTencent } from '../market/historyService';

// --- Types ---

export type ChainNodeStatus = 'activated' | 'transmitting' | 'inactive';

export interface ChainNode {
  symbol: string;
  name: string;
  shortName: string;
  status: ChainNodeStatus;
  /** 主窗口区间涨跌幅（%）；API 字段名历史原因仍为 change10d */
  change10d: number;
  /** 约 6 个月（120 交易日）涨跌幅（%），辅提示 */
  changeAux?: number;
  primaryWindowDays?: number;
  maxHistoryDays?: number;
  windowNote?: string;
  label: string;
}

export interface ChainStatusResponse {
  nodes: ChainNode[];
  updatedAt: string;
  /** 口径说明，供前端展示 */
  methodSummary?: string;
}

// --- Constants ---

/** 主排名：最多约 5 年 */
const PRIMARY_DAY_MAX = 1250;
/** 主排名：约 4 年（数据足够时优先） */
const PRIMARY_DAY_MID = 1000;
/** 主排名：约 3 年（中长窗下限） */
const PRIMARY_DAY_MIN = 750;
/** 辅窗口：约 6 个月（2～6 个月取上沿偏稳） */
const AUX_TRADING_DAYS = 120;
/** 状态切换：原始排名状态需连续命中次数 */
export const CHAIN_STATUS_HYSTERESIS_RUNS = 2;

export const CHAIN_METHOD_SUMMARY =
  '主排名按约3～5年有效K线择优；近6月为辅；状态连续2次一致才切换。';

/**
 * 由可用 K 线跨度决定主排名窗口（交易日）。
 */
export function resolvePrimaryWindowDays(maxSpan: number): { primaryDays: number; windowNote: string } {
  if (maxSpan <= 0) {
    return { primaryDays: 0, windowNote: '无数据' };
  }
  if (maxSpan < 250) {
    return { primaryDays: maxSpan, windowNote: `数据有限·${maxSpan}日` };
  }
  if (maxSpan >= PRIMARY_DAY_MAX) {
    return { primaryDays: PRIMARY_DAY_MAX, windowNote: '主排名约满5年' };
  }
  if (maxSpan >= PRIMARY_DAY_MID) {
    return { primaryDays: PRIMARY_DAY_MID, windowNote: '主排名约4年' };
  }
  if (maxSpan >= PRIMARY_DAY_MIN) {
    return { primaryDays: PRIMARY_DAY_MIN, windowNote: '主排名约3年' };
  }
  return { primaryDays: maxSpan, windowNote: `主排名·${maxSpan}日` };
}

/**
 * Generate human-readable label based on primary change%, status, and aux (short) change.
 */
function generateLabel(
  primaryChange: number,
  status: ChainNodeStatus,
  auxChange?: number | null
): string {
  if (status === 'inactive' && auxChange != null && auxChange >= 12) {
    return '可埋伏·短期转强';
  }
  if (status === 'inactive' && auxChange != null && auxChange <= -10) {
    return '可埋伏·短期承压';
  }
  if (status === 'activated') {
    if (primaryChange >= 200) return '主升浪已走';
    if (primaryChange >= 100) return '长期大牛';
    return '涨幅领先';
  }
  if (status === 'transmitting') {
    if (primaryChange >= 50) return '跟涨中';
    if (primaryChange >= 10) return '酝酿启动';
    if (auxChange != null && auxChange >= 8) return '蓄势·短期偏强';
    return '蓄势待发';
  }
  if (primaryChange < 10) return '可埋伏';
  return '涨幅落后';
}

export const CHAIN_NODES = [
  { index: 0, symbol: '518880', name: '黄金', shortName: 'Au' },
  { index: 1, symbol: '161226', name: '白银', shortName: 'Ag' },
  { index: 2, symbol: '512400', name: '有色', shortName: 'Cu' },
  { index: 3, symbol: '515220', name: '煤炭', shortName: '煤' },
  { index: 4, symbol: '516020', name: '化工', shortName: '化' },
  { index: 5, symbol: '159886', name: '橡胶', shortName: '胶' },
  { index: 6, symbol: '161129', name: '原油', shortName: '油' },
];

// --- Helper: get K-line data from DB, fallback to Tencent API ---

function getKlineFromDb(
  stockCode: string,
  days: number,
  db: Database.Database
): { close: number; date: string }[] {
  const rows = db.prepare(
    `SELECT trade_date, close_price FROM market_history
     WHERE stock_code = ? ORDER BY trade_date DESC LIMIT ?`
  ).all(stockCode, days) as { trade_date: string; close_price: number }[];

  return rows.map(r => ({ close: r.close_price, date: r.trade_date }));
}

async function getKlineData(
  stockCode: string,
  days: number,
  db: Database.Database
): Promise<{ close: number; date: string }[]> {
  const dbRows = getKlineFromDb(stockCode, days, db);
  if (dbRows.length >= days) {
    return dbRows;
  }

  const now = new Date();
  const start = new Date();
  start.setDate(start.getDate() - Math.ceil(days * 1.8));
  const startStr = start.toISOString().slice(0, 10);
  const endStr = now.toISOString().slice(0, 10);

  try {
    const klines = await fetchKlineFromTencent(stockCode, startStr, endStr);
    if (klines.length > 0) {
      const recent = klines.slice(-days);
      return recent.map(k => ({ close: k.close, date: k.tradeDate }));
    }
  } catch {
    // API failed, fall through
  }

  return dbRows;
}

// --- Core functions ---

/**
 * Map chain node status based on relative ranking among all nodes.
 * 按主窗口区间涨跌幅横截面排名。
 */
export function assignStatusByRanking(
  changes: { index: number; change: number }[]
): Map<number, ChainNodeStatus> {
  const sorted = [...changes].sort((a, b) => b.change - a.change);
  const n = sorted.length;
  const result = new Map<number, ChainNodeStatus>();

  const activatedCount = Math.max(1, Math.round(n * 0.3));
  const inactiveCount = Math.max(1, Math.round(n * 0.3));

  sorted.forEach((item, rank) => {
    if (rank < activatedCount) {
      result.set(item.index, 'activated');
    } else if (rank >= n - inactiveCount) {
      result.set(item.index, 'inactive');
    } else {
      result.set(item.index, 'transmitting');
    }
  });

  return result;
}

/**
 * Legacy: map single change to status (used in tests for boundary logic).
 */
export function mapChangeToStatus(change60d: number): ChainNodeStatus {
  if (change60d > 8) return 'activated';
  if (change60d >= 0) return 'transmitting';
  return 'inactive';
}

/**
 * Calculate N-day change for a single ETF.
 */
async function calculateNdChange(
  stockCode: string,
  days: number,
  db: Database.Database
): Promise<number> {
  const data = await getKlineData(stockCode, days + 5, db);

  if (data.length < 2) {
    return 0;
  }

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

  const latestClose = sorted[sorted.length - 1].close;
  const idx = Math.max(0, sorted.length - days - 1);
  const closeNdAgo = sorted[idx].close;

  if (closeNdAgo <= 0) return 0;

  const change = ((latestClose - closeNdAgo) / closeNdAgo) * 100;
  return Math.round(change * 100) / 100;
}

export interface PrimaryWindowResult {
  change: number;
  primaryDaysUsed: number;
  maxHistoryDays: number;
  windowNote: string;
}

/**
 * 主窗口区间涨跌幅（3～5 年择优）+ 说明文案。
 */
export async function calculatePrimaryWindowChange(
  stockCode: string,
  db: Database.Database
): Promise<PrimaryWindowResult> {
  const data = await getKlineData(stockCode, PRIMARY_DAY_MAX + 10, db);

  if (data.length < 2) {
    return { change: 0, primaryDaysUsed: 0, maxHistoryDays: 0, windowNote: '无数据' };
  }

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const maxHistoryDays = sorted.length - 1;
  const { primaryDays, windowNote } = resolvePrimaryWindowDays(maxHistoryDays);

  if (primaryDays <= 0) {
    return { change: 0, primaryDaysUsed: 0, maxHistoryDays, windowNote };
  }

  const latestClose = sorted[sorted.length - 1].close;
  const idx = Math.max(0, sorted.length - primaryDays - 1);
  const oldClose = sorted[idx].close;

  if (oldClose <= 0) {
    return { change: 0, primaryDaysUsed: primaryDays, maxHistoryDays, windowNote };
  }

  const change = ((latestClose - oldClose) / oldClose) * 100;
  return {
    change: Math.round(change * 100) / 100,
    primaryDaysUsed: primaryDays,
    maxHistoryDays,
    windowNote,
  };
}

/**
 * @deprecated 语义见 calculatePrimaryWindowChange；保留返回单一数字供旧测试调用。
 */
export async function calculateCompositeChange(
  stockCode: string,
  db: Database.Database
): Promise<number> {
  const r = await calculatePrimaryWindowChange(stockCode, db);
  return r.change;
}

/**
 * 状态滞回：原始排名状态 raw 与已提交 committed 不一致时，需连续 HYSTERESIS 次相同 raw 才切换为 raw。
 */
export function applyHysteresis(
  raw: ChainNodeStatus,
  committed: ChainNodeStatus | null,
  pending: ChainNodeStatus | null,
  pendingCount: number
): { status: ChainNodeStatus; pendingStatus: string | null; pendingCount: number } {
  if (committed === null) {
    return { status: raw, pendingStatus: null, pendingCount: 0 };
  }
  if (raw === committed) {
    return { status: committed, pendingStatus: null, pendingCount: 0 };
  }
  if (pending === raw) {
    const next = pendingCount + 1;
    if (next >= CHAIN_STATUS_HYSTERESIS_RUNS) {
      return { status: raw, pendingStatus: null, pendingCount: 0 };
    }
    return { status: committed, pendingStatus: raw, pendingCount: next };
  }
  return { status: committed, pendingStatus: raw, pendingCount: 1 };
}

type ChainStatusRow = {
  node_index: number;
  symbol: string;
  name: string;
  short_name: string;
  status: string;
  change_10d: number;
  change_aux: number | null;
  primary_days_used: number | null;
  max_history_days: number | null;
  window_note: string | null;
  pending_status: string | null;
  pending_count: number | null;
  updated_at: string;
};

/**
 * Get current chain status from chain_status table.
 * `window_note` 以库内落库为准；旧行缺列时再按 max_history_days 推导。
 */
export function getCurrentChainStatus(db?: Database.Database): ChainStatusResponse | null {
  const database = db || getDatabase();

  const rows = database.prepare(
    `SELECT node_index, symbol, name, short_name, status, change_10d, change_aux,
            primary_days_used, max_history_days, window_note, pending_status, pending_count, updated_at
     FROM chain_status ORDER BY node_index ASC`
  ).all() as ChainStatusRow[];

  if (rows.length === 0) return null;

  const latestUpdate = rows.reduce(
    (max, r) => (r.updated_at > max ? r.updated_at : max),
    rows[0].updated_at
  );

  return {
    nodes: rows.map(r => {
      const status = r.status as ChainNodeStatus;
      const aux = r.change_aux ?? undefined;
      return {
        symbol: r.symbol,
        name: r.name,
        shortName: r.short_name,
        status,
        change10d: r.change_10d,
        changeAux: aux,
        primaryWindowDays: r.primary_days_used ?? undefined,
        maxHistoryDays: r.max_history_days ?? undefined,
        windowNote: (() => {
          const stored = r.window_note != null ? String(r.window_note).trim() : '';
          if (stored !== '') return stored;
          if (r.max_history_days != null && r.max_history_days > 0) {
            return resolvePrimaryWindowDays(r.max_history_days).windowNote;
          }
          return undefined;
        })(),
        label: generateLabel(r.change_10d, status, aux),
      };
    }),
    updatedAt: latestUpdate,
    methodSummary: CHAIN_METHOD_SUMMARY,
  };
}

function createActivationMessages(
  node: typeof CHAIN_NODES[number],
  primaryChangePct: number,
  chainStatus: ChainStatusResponse | null,
  db: Database.Database
): void {
  const users = db.prepare(
    `SELECT id FROM users WHERE last_login_at > datetime('now', '-24 hours')`
  ).all() as { id: number }[];

  const targetUsers =
    users.length > 0 ? users : (db.prepare('SELECT id FROM users').all() as { id: number }[]);

  if (targetUsers.length === 0) return;

  const summary = `${node.name}节点激活，长周期主涨幅${primaryChangePct}%`;
  const detail = JSON.stringify({
    nodeIndex: node.index,
    symbol: node.symbol,
    name: node.name,
    shortName: node.shortName,
    change10d: primaryChangePct,
    chainStatus: chainStatus?.nodes ?? [],
  });
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read, created_at)
     VALUES (?, 'chain_activation', ?, '商品传导链', ?, ?, 0, ?)`
  );

  const insertAll = db.transaction(() => {
    for (const user of targetUsers) {
      stmt.run(user.id, node.symbol, summary, detail, now);
    }
  });

  insertAll();
}

type HystRow = {
  node_index: number;
  status: string;
  pending_status: string | null;
  pending_count: number | null;
};

/**
 * Main update: 主窗排名 + 辅窗 + 滞回写库；激活消息在「已提交状态」由 inactive→activated 时触发。
 */
export async function updateChainStatus(db?: Database.Database): Promise<ChainStatusResponse> {
  const database = db || getDatabase();

  const previousStatus = getCurrentChainStatus(database);
  const previousMap = new Map<number, ChainNodeStatus>();
  if (previousStatus) {
    for (let i = 0; i < previousStatus.nodes.length; i++) {
      const nodeConfig = CHAIN_NODES[i];
      if (nodeConfig) {
        previousMap.set(nodeConfig.index, previousStatus.nodes[i].status);
      }
    }
  }

  const hystRows = database
    .prepare(
      `SELECT node_index, status, pending_status, pending_count FROM chain_status`
    )
    .all() as HystRow[];
  const hystMap = new Map<number, { committed: ChainNodeStatus; pending: ChainNodeStatus | null; count: number }>();
  for (const h of hystRows) {
    hystMap.set(h.node_index, {
      committed: h.status as ChainNodeStatus,
      pending: (h.pending_status as ChainNodeStatus | null) ?? null,
      count: h.pending_count ?? 0,
    });
  }

  type NodeCalc = {
    node: typeof CHAIN_NODES[number];
    primary: number;
    aux: number;
    primaryDays: number;
    maxHist: number;
    windowNote: string;
  };

  const calcs: NodeCalc[] = [];

  for (const node of CHAIN_NODES) {
    try {
      const pw = await calculatePrimaryWindowChange(node.symbol, database);
      const aux = await calculateNdChange(node.symbol, AUX_TRADING_DAYS, database);
      calcs.push({
        node,
        primary: pw.change,
        aux,
        primaryDays: pw.primaryDaysUsed,
        maxHist: pw.maxHistoryDays,
        windowNote: pw.windowNote,
      });
    } catch {
      calcs.push({
        node,
        primary: 0,
        aux: 0,
        primaryDays: 0,
        maxHist: 0,
        windowNote: '无数据',
      });
    }
  }

  const rankingInput = calcs.map(c => ({ index: c.node.index, change: c.primary }));
  const statusMap = assignStatusByRanking(rankingInput);

  const now = new Date().toISOString();

  const stmt = database.prepare(
    `INSERT OR REPLACE INTO chain_status (
       node_index, symbol, name, short_name, status, change_10d, change_aux,
       primary_days_used, max_history_days, window_note, pending_status, pending_count, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const committedResults: {
    node: typeof CHAIN_NODES[number];
    primary: number;
    aux: number;
    primaryDays: number;
    maxHist: number;
    windowNote: string;
    status: ChainNodeStatus;
  }[] = [];

  const persistAll = database.transaction(() => {
    for (const c of calcs) {
      const raw = statusMap.get(c.node.index) || 'inactive';
      const prev = hystMap.get(c.node.index);
      const committedPrev = prev?.committed ?? null;
      const { status, pendingStatus, pendingCount } = applyHysteresis(
        raw,
        committedPrev,
        prev?.pending ?? null,
        prev?.count ?? 0
      );

      stmt.run(
        c.node.index,
        c.node.symbol,
        c.node.name,
        c.node.shortName,
        status,
        c.primary,
        c.aux,
        c.primaryDays,
        c.maxHist,
        c.windowNote,
        pendingStatus,
        pendingCount,
        now
      );

      committedResults.push({
        node: c.node,
        primary: c.primary,
        aux: c.aux,
        primaryDays: c.primaryDays,
        maxHist: c.maxHist,
        windowNote: c.windowNote,
        status,
      });
    }
  });

  persistAll();

  const currentStatus: ChainStatusResponse = {
    nodes: committedResults.map(r => ({
      symbol: r.node.symbol,
      name: r.node.name,
      shortName: r.node.shortName,
      status: r.status,
      change10d: r.primary,
      changeAux: r.aux,
      primaryWindowDays: r.primaryDays,
      maxHistoryDays: r.maxHist,
      windowNote: r.windowNote,
      label: generateLabel(r.primary, r.status, r.aux),
    })),
    updatedAt: now,
    methodSummary: CHAIN_METHOD_SUMMARY,
  };

  for (const r of committedResults) {
    const prevStatus = previousMap.get(r.node.index);
    if (prevStatus === 'inactive' && r.status === 'activated') {
      createActivationMessages(r.node, r.primary, currentStatus, database);
    }
  }

  return currentStatus;
}
