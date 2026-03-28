/**
 * 商品传导链监控服务
 *
 * 纯规则引擎，零AI调用。
 * 监控7个商品ETF节点：黄金→白银→有色→煤炭→化工→橡胶→原油
 * 基于5年涨跌幅相对排名判断节点传导状态（大宗商品长周期轮动）：
 *   排名前30%（前2名）→ activated（长期涨幅领先，主升浪已走）
 *   排名中间40%（3名）→ transmitting（正在传导，酝酿中）
 *   排名后30%（后2名）→ inactive（涨幅落后，尚未轮到，适合埋伏）
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
  change10d: number;
  label: string;
}

export interface ChainStatusResponse {
  nodes: ChainNode[];
  updatedAt: string;
}

// --- Constants ---

/**
 * Generate human-readable label based on change% and status.
 */
function generateLabel(change: number, status: ChainNodeStatus): string {
  if (status === 'activated') {
    if (change >= 200) return '主升浪已走';
    if (change >= 100) return '长期大牛';
    return '涨幅领先';
  }
  if (status === 'transmitting') {
    if (change >= 50) return '跟涨中';
    if (change >= 10) return '酝酿启动';
    return '蓄势待发';
  }
  // inactive
  if (change < 0) return '可埋伏';
  if (change < 10) return '可埋伏';
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
      return recent.map(k => ({ close: k.close, date: k.tradeDate }));
    }
  } catch {
    // API failed, fall through
  }

  // Return whatever DB had
  return dbRows;
}

// --- Core functions ---

/**
 * Map chain node status based on relative ranking among all nodes.
 * 按60日涨跌幅排名分配状态（适合任何行情下区分传导先后）：
 *   排名前30% → activated（涨幅领先，主升浪已走）
 *   排名中间40% → transmitting（正在传导，酝酿中）
 *   排名后30% → inactive（涨幅落后，尚未轮到，适合埋伏）
 *
 * 对于7个节点：前2名activated，中间3名transmitting，后2名inactive
 */
export function assignStatusByRanking(
  changes: { index: number; change: number }[]
): Map<number, ChainNodeStatus> {
  const sorted = [...changes].sort((a, b) => b.change - a.change); // 降序
  const n = sorted.length;
  const result = new Map<number, ChainNodeStatus>();

  // 前30%=activated, 中间40%=transmitting, 后30%=inactive
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
 * 保留兼容，但实际传导链使用 assignStatusByRanking。
 */
export function mapChangeToStatus(change60d: number): ChainNodeStatus {
  if (change60d > 8) return 'activated';
  if (change60d >= 0) return 'transmitting';
  return 'inactive';
}

/**
 * Calculate N-day change for a single ETF.
 * changeNd = (latest close - close N days ago) / close N days ago * 100
 */
async function calculateNdChange(
  stockCode: string,
  days: number,
  db: Database.Database
): Promise<number> {
  const data = await getKlineData(stockCode, days + 5, db); // extra buffer

  if (data.length < 2) {
    return 0;
  }

  // Data is in DESC order from DB, reverse for chronological
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

  const latestClose = sorted[sorted.length - 1].close;
  const idx = Math.max(0, sorted.length - days - 1);
  const closeNdAgo = sorted[idx].close;

  if (closeNdAgo <= 0) return 0;

  const change = ((latestClose - closeNdAgo) / closeNdAgo) * 100;
  return Math.round(change * 100) / 100;
}

/**
 * Calculate 5-year(1250交易日)涨跌幅 for a single ETF.
 * 用5年涨跌幅判断大宗商品长周期轮动，适合埋伏下一个准备涨的品种。
 * 数据不足1250交易日时，使用可用的最长周期。
 */
export async function calculateCompositeChange(
  stockCode: string,
  db: Database.Database
): Promise<number> {
  // 尝试5年(1250交易日)，数据不足则降级
  const TARGET_DAYS = 1250;
  const data = await getKlineData(stockCode, TARGET_DAYS + 10, db);

  if (data.length < 2) return 0;

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const latestClose = sorted[sorted.length - 1].close;

  // 使用可用的最长周期（最多750交易日）
  const actualDays = Math.min(TARGET_DAYS, sorted.length - 1);
  const idx = Math.max(0, sorted.length - actualDays - 1);
  const oldClose = sorted[idx].close;

  if (oldClose <= 0) return 0;

  const change = ((latestClose - oldClose) / oldClose) * 100;
  return Math.round(change * 100) / 100;
}

/**
 * Get current chain status from chain_status table.
 */
export function getCurrentChainStatus(db?: Database.Database): ChainStatusResponse | null {
  const database = db || getDatabase();

  const rows = database.prepare(
    `SELECT node_index, symbol, name, short_name, status, change_10d, updated_at
     FROM chain_status ORDER BY node_index ASC`
  ).all() as {
    node_index: number;
    symbol: string;
    name: string;
    short_name: string;
    status: string;
    change_10d: number;
    updated_at: string;
  }[];

  if (rows.length === 0) return null;

  const latestUpdate = rows.reduce(
    (max, r) => (r.updated_at > max ? r.updated_at : max),
    rows[0].updated_at
  );

  return {
    nodes: rows.map(r => ({
      symbol: r.symbol,
      name: r.name,
      shortName: r.short_name,
      status: r.status as ChainNodeStatus,
      change10d: r.change_10d,
      label: generateLabel(r.change_10d, r.status as ChainNodeStatus),
    })),
    updatedAt: latestUpdate,
  };
}


/**
 * Create chain_activation messages for all active users when a node transitions
 * from inactive → activated.
 */
function createActivationMessages(
  node: typeof CHAIN_NODES[number],
  change10d: number,
  chainStatus: ChainStatusResponse | null,
  db: Database.Database
): void {
  // Active users = logged in within last 24 hours
  const users = db.prepare(
    `SELECT id FROM users WHERE last_login_at > datetime('now', '-24 hours')`
  ).all() as { id: number }[];

  // Fallback: if no users with recent login, get all users
  const targetUsers = users.length > 0
    ? users
    : db.prepare('SELECT id FROM users').all() as { id: number }[];

  if (targetUsers.length === 0) return;

  const summary = `${node.name}节点激活，近期综合涨幅${change10d}%`;
  const detail = JSON.stringify({
    nodeIndex: node.index,
    symbol: node.symbol,
    name: node.name,
    shortName: node.shortName,
    change10d,
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

/**
 * Main update function: calculate 10d change for all nodes, detect activations, persist.
 */
export async function updateChainStatus(db?: Database.Database): Promise<ChainStatusResponse> {
  const database = db || getDatabase();

  // Get previous status for activation detection
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

  // Calculate 60d change for all nodes
  const changeData: { node: typeof CHAIN_NODES[number]; change10d: number }[] = [];

  for (const node of CHAIN_NODES) {
    try {
      const change10d = await calculateCompositeChange(node.symbol, database);
      changeData.push({ node, change10d });
    } catch {
      // If one node fails, still include it with 0 change
      changeData.push({ node, change10d: 0 });
    }
  }

  // Assign status by relative ranking (not absolute thresholds)
  const rankingInput = changeData.map(d => ({ index: d.node.index, change: d.change10d }));
  const statusMap = assignStatusByRanking(rankingInput);

  const results = changeData.map(d => ({
    node: d.node,
    change10d: d.change10d,
    status: statusMap.get(d.node.index) || 'inactive' as ChainNodeStatus,
  }));

  const now = new Date().toISOString();

  // Persist to chain_status table (INSERT OR REPLACE since PRIMARY KEY is node_index)
  const stmt = database.prepare(
    `INSERT OR REPLACE INTO chain_status (node_index, symbol, name, short_name, status, change_10d, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const persistAll = database.transaction(() => {
    for (const r of results) {
      stmt.run(r.node.index, r.node.symbol, r.node.name, r.node.shortName, r.status, r.change10d, now);
    }
  });

  persistAll();

  // Build current status response
  const currentStatus: ChainStatusResponse = {
    nodes: results.map(r => ({
      symbol: r.node.symbol,
      name: r.node.name,
      shortName: r.node.shortName,
      status: r.status,
      change10d: r.change10d,
      label: generateLabel(r.change10d, r.status),
    })),
    updatedAt: now,
  };

  // Detect activations: inactive → activated
  for (const r of results) {
    const prevStatus = previousMap.get(r.node.index);
    if (prevStatus === 'inactive' && r.status === 'activated') {
      createActivationMessages(r.node, r.change10d, currentStatus, database);
    }
  }

  return currentStatus;
}
