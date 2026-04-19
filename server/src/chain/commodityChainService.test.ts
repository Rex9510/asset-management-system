import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  mapChangeToStatus,
  assignStatusByRanking,
  getCurrentChainStatus,
  updateChainStatus,
  calculateCompositeChange,
  applyHysteresis,
  resolvePrimaryWindowDays,
  CHAIN_NODES,
} from './commodityChainService';

// Mock the Tencent API fetch to avoid real network calls
jest.mock('../market/historyService', () => ({
  fetchKlineFromTencent: jest.fn().mockResolvedValue([]),
}));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db);
  return db;
}

/**
 * Seed market_history with synthetic K-line data for an ETF.
 * Generates `count` trading days ending today, with configurable price trend.
 */
function seedKlineData(
  db: Database.Database,
  stockCode: string,
  opts: {
    count?: number;
    basePrice?: number;
    priceGrowth?: number; // total % growth over the period
  } = {}
): void {
  const {
    count = 75,
    basePrice = 1.0,
    priceGrowth = 5,
  } = opts;

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO market_history
     (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const insert = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (count - 1 - i));
      const dateStr = date.toISOString().slice(0, 10);

      const progress = i / (count - 1);
      const price = basePrice * (1 + (priceGrowth / 100) * progress);

      stmt.run(stockCode, dateStr, price * 0.99, price, price * 1.01, price * 0.98, 1000000);
    }
  });
  insert();
}

function seedUser(db: Database.Database, lastLoginRecent = true): number {
  const loginAt = lastLoginRecent
    ? new Date().toISOString()
    : new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO users (username, password_hash, last_login_at) VALUES (?, ?, ?)').run(
    `user_${Date.now()}_${Math.random()}`, 'hash', loginAt
  );
  return (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
}

describe('commodityChainService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    jest.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  // --- mapChangeToStatus ---

  describe('mapChangeToStatus', () => {
    it('should return activated when 60d change > 8%', () => {
      expect(mapChangeToStatus(8.01)).toBe('activated');
      expect(mapChangeToStatus(10)).toBe('activated');
      expect(mapChangeToStatus(35)).toBe('activated');
    });

    it('should return transmitting when 0% <= 60d change <= 8%', () => {
      expect(mapChangeToStatus(0)).toBe('transmitting');
      expect(mapChangeToStatus(3)).toBe('transmitting');
      expect(mapChangeToStatus(5)).toBe('transmitting');
      expect(mapChangeToStatus(8)).toBe('transmitting');
    });

    it('should return inactive when 60d change < 0%', () => {
      expect(mapChangeToStatus(-0.01)).toBe('inactive');
      expect(mapChangeToStatus(-5)).toBe('inactive');
      expect(mapChangeToStatus(-20)).toBe('inactive');
    });

    it('should handle boundary values correctly', () => {
      // Exactly 8% is transmitting (not > 8)
      expect(mapChangeToStatus(8)).toBe('transmitting');
      // Exactly 0% is transmitting (>= 0)
      expect(mapChangeToStatus(0)).toBe('transmitting');
    });
  });

  // --- assignStatusByRanking ---

  describe('assignStatusByRanking', () => {
    it('should assign top 2 as activated, middle 3 as transmitting, bottom 2 as inactive for 7 nodes', () => {
      const changes = [
        { index: 0, change: 7 },    // rank 4 → transmitting
        { index: 1, change: 35 },   // rank 1 → activated
        { index: 2, change: 12 },   // rank 3 → transmitting
        { index: 3, change: 19 },   // rank 2 → activated
        { index: 4, change: 5 },    // rank 5 → transmitting
        { index: 5, change: -2 },   // rank 6 → inactive
        { index: 6, change: -8 },   // rank 7 → inactive
      ];
      const result = assignStatusByRanking(changes);
      expect(result.get(1)).toBe('activated');   // 35% top
      expect(result.get(3)).toBe('activated');   // 19% 2nd
      expect(result.get(2)).toBe('transmitting'); // 12% 3rd
      expect(result.get(0)).toBe('transmitting'); // 7% 4th
      expect(result.get(4)).toBe('transmitting'); // 5% 5th
      expect(result.get(5)).toBe('inactive');    // -2% 6th
      expect(result.get(6)).toBe('inactive');    // -8% 7th
    });

    it('should distribute statuses even when all changes are positive (bull market)', () => {
      const changes = [
        { index: 0, change: 7 },
        { index: 1, change: 35 },
        { index: 2, change: 12 },
        { index: 3, change: 19 },
        { index: 4, change: 16 },
        { index: 5, change: 10 },
        { index: 6, change: 105 },
      ];
      const result = assignStatusByRanking(changes);
      // Top 2: index 6 (105%), index 1 (35%)
      expect(result.get(6)).toBe('activated');
      expect(result.get(1)).toBe('activated');
      // Bottom 2: index 0 (7%), index 5 (10%)
      expect(result.get(0)).toBe('inactive');
      expect(result.get(5)).toBe('inactive');
      // Middle 3: transmitting
      expect(result.get(3)).toBe('transmitting');
      expect(result.get(4)).toBe('transmitting');
      expect(result.get(2)).toBe('transmitting');
    });

    it('should handle all same values', () => {
      const changes = Array.from({ length: 7 }, (_, i) => ({ index: i, change: 5 }));
      const result = assignStatusByRanking(changes);
      // Should still distribute: 2 activated, 3 transmitting, 2 inactive
      let activated = 0, transmitting = 0, inactive = 0;
      result.forEach(s => {
        if (s === 'activated') activated++;
        else if (s === 'transmitting') transmitting++;
        else inactive++;
      });
      expect(activated).toBe(2);
      expect(transmitting).toBe(3);
      expect(inactive).toBe(2);
    });
  });

  // --- getCurrentChainStatus ---

  describe('getCurrentChainStatus', () => {
    it('should return null when no chain status exists', () => {
      expect(getCurrentChainStatus(db)).toBeNull();
    });

    it('should return all nodes in order', () => {
      const now = new Date().toISOString();
      const stmt = db.prepare(
        `INSERT INTO chain_status (node_index, symbol, name, short_name, status, change_10d, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const node of CHAIN_NODES) {
        stmt.run(node.index, node.symbol, node.name, node.shortName, 'inactive', 0, now);
      }

      const result = getCurrentChainStatus(db);
      expect(result).not.toBeNull();
      expect(result!.nodes).toHaveLength(7);
      expect(result!.nodes[0].symbol).toBe('518880');
      expect(result!.nodes[0].name).toBe('黄金');
      expect(result!.nodes[0].shortName).toBe('Au');
      expect(result!.nodes[6].symbol).toBe('161129');
      expect(result!.nodes[6].name).toBe('原油');
      expect(result!.updatedAt).toBe(now);
      expect(result!.methodSummary).toContain('主排名');
    });

    it('prefers stored window_note over recomputed label from max_history_days', () => {
      const now = new Date().toISOString();
      const stmt = db.prepare(
        `INSERT INTO chain_status (node_index, symbol, name, short_name, status, change_10d, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const node of CHAIN_NODES) {
        stmt.run(node.index, node.symbol, node.name, node.shortName, 'inactive', 0, now);
      }
      db.prepare(
        `UPDATE chain_status SET max_history_days = 2000, window_note = ? WHERE node_index = 0`
      ).run('计算当时口径快照');

      const result = getCurrentChainStatus(db);
      expect(result!.nodes[0].windowNote).toBe('计算当时口径快照');
    });
  });

  describe('resolvePrimaryWindowDays', () => {
    it('picks 5y cap when history is long', () => {
      const r = resolvePrimaryWindowDays(2000);
      expect(r.primaryDays).toBe(1250);
      expect(r.windowNote).toContain('5年');
    });
    it('picks 3y floor in mid band', () => {
      const r = resolvePrimaryWindowDays(800);
      expect(r.primaryDays).toBe(750);
    });
  });

  describe('applyHysteresis', () => {
    it('commits immediately when no prior committed state', () => {
      const o = applyHysteresis('activated', null, null, 0);
      expect(o.status).toBe('activated');
      expect(o.pendingStatus).toBeNull();
    });
    it('requires two matching raw proposals to switch', () => {
      const a = applyHysteresis('activated', 'inactive', null, 0);
      expect(a.status).toBe('inactive');
      expect(a.pendingStatus).toBe('activated');
      expect(a.pendingCount).toBe(1);
      const b = applyHysteresis('activated', 'inactive', 'activated', 1);
      expect(b.status).toBe('activated');
      expect(b.pendingStatus).toBeNull();
    });
  });

  // --- updateChainStatus ---

  describe('updateChainStatus', () => {
    it('should create initial chain status with all nodes and ranking-based statuses', async () => {
      // Seed K-line data for all 7 ETFs with varying 60d growth
      // Ranking: 前2名activated, 中间3名transmitting, 后2名inactive
      seedKlineData(db, '518880', { count: 70, priceGrowth: 30 });  // rank 1 → activated
      seedKlineData(db, '161226', { count: 70, priceGrowth: 20 });  // rank 2 → activated
      seedKlineData(db, '512400', { count: 70, priceGrowth: 15 });  // rank 3 → transmitting
      seedKlineData(db, '515220', { count: 70, priceGrowth: 10 });  // rank 4 → transmitting
      seedKlineData(db, '516020', { count: 70, priceGrowth: 5 });   // rank 5 → transmitting
      seedKlineData(db, '159886', { count: 70, priceGrowth: -2 });  // rank 6 → inactive
      seedKlineData(db, '161129', { count: 70, priceGrowth: -8 });  // rank 7 → inactive

      const result = await updateChainStatus(db);

      expect(result.nodes).toHaveLength(7);
      expect(result.nodes[0].symbol).toBe('518880');
      expect(result.nodes[0].name).toBe('黄金');
      expect(result.nodes[0].status).toBe('activated');
      expect(result.nodes[5].status).toBe('inactive');
      expect(result.nodes[6].status).toBe('inactive');
      expect(result.updatedAt).toBeTruthy();

      // Verify persisted to DB
      const stored = getCurrentChainStatus(db);
      expect(stored).not.toBeNull();
      expect(stored!.nodes).toHaveLength(7);
    });

    it('should detect activation and create messages', async () => {
      const userId = seedUser(db);

      // First run: gold is in bottom rank (inactive)
      seedKlineData(db, '518880', { count: 70, priceGrowth: -10 }); // rank 7 → inactive
      seedKlineData(db, '161226', { count: 70, priceGrowth: 20 });
      seedKlineData(db, '512400', { count: 70, priceGrowth: 15 });
      seedKlineData(db, '515220', { count: 70, priceGrowth: 10 });
      seedKlineData(db, '516020', { count: 70, priceGrowth: 5 });
      seedKlineData(db, '159886', { count: 70, priceGrowth: 0 });
      seedKlineData(db, '161129', { count: 70, priceGrowth: -5 });  // rank 6 → inactive
      await updateChainStatus(db);

      // Second run: gold jumps to top rank (activated)
      db.prepare('DELETE FROM market_history').run();
      seedKlineData(db, '518880', { count: 70, priceGrowth: 50 });  // rank 1 → activated
      seedKlineData(db, '161226', { count: 70, priceGrowth: 20 });
      seedKlineData(db, '512400', { count: 70, priceGrowth: 15 });
      seedKlineData(db, '515220', { count: 70, priceGrowth: 10 });
      seedKlineData(db, '516020', { count: 70, priceGrowth: 5 });
      seedKlineData(db, '159886', { count: 70, priceGrowth: 0 });
      seedKlineData(db, '161129', { count: 70, priceGrowth: -5 });

      await updateChainStatus(db);
      // 滞回：需连续两次相同「原始排名状态」才提交为 activated，第三次运行才触发 inactive→activated 消息
      await updateChainStatus(db);

      // Verify chain_activation message was created for gold (inactive → activated)
      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'chain_activation'`
      ).all() as { user_id: number; stock_code: string; summary: string; detail: string }[];

      expect(messages.length).toBeGreaterThanOrEqual(1);
      const goldMsg = messages.find(m => m.stock_code === '518880');
      expect(goldMsg).toBeDefined();
      expect(goldMsg!.user_id).toBe(userId);
      expect(goldMsg!.summary).toContain('黄金');
      expect(goldMsg!.summary).toContain('激活');
      expect(goldMsg!.summary).toContain('长周期');
    });

    it('should not create messages when status stays the same', async () => {
      seedUser(db);

      // Both runs: same ranking distribution, no status changes
      seedKlineData(db, '518880', { count: 70, priceGrowth: 30 });
      seedKlineData(db, '161226', { count: 70, priceGrowth: 20 });
      seedKlineData(db, '512400', { count: 70, priceGrowth: 15 });
      seedKlineData(db, '515220', { count: 70, priceGrowth: 10 });
      seedKlineData(db, '516020', { count: 70, priceGrowth: 5 });
      seedKlineData(db, '159886', { count: 70, priceGrowth: -2 });
      seedKlineData(db, '161129', { count: 70, priceGrowth: -8 });

      await updateChainStatus(db);
      await updateChainStatus(db);

      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'chain_activation'`
      ).all();
      expect(messages.length).toBe(0);
    });

    it('should not create messages for transmitting→activated transition', async () => {
      seedUser(db);

      // First run: gold is in middle rank (transmitting)
      seedKlineData(db, '518880', { count: 70, priceGrowth: 10 });  // rank 3 → transmitting
      seedKlineData(db, '161226', { count: 70, priceGrowth: 30 });
      seedKlineData(db, '512400', { count: 70, priceGrowth: 20 });
      seedKlineData(db, '515220', { count: 70, priceGrowth: 8 });
      seedKlineData(db, '516020', { count: 70, priceGrowth: 5 });
      seedKlineData(db, '159886', { count: 70, priceGrowth: -2 });
      seedKlineData(db, '161129', { count: 70, priceGrowth: -8 });
      await updateChainStatus(db);

      // Second run: gold jumps to top rank (activated)
      db.prepare('DELETE FROM market_history').run();
      seedKlineData(db, '518880', { count: 70, priceGrowth: 50 });  // rank 1 → activated
      seedKlineData(db, '161226', { count: 70, priceGrowth: 30 });
      seedKlineData(db, '512400', { count: 70, priceGrowth: 20 });
      seedKlineData(db, '515220', { count: 70, priceGrowth: 8 });
      seedKlineData(db, '516020', { count: 70, priceGrowth: 5 });
      seedKlineData(db, '159886', { count: 70, priceGrowth: -2 });
      seedKlineData(db, '161129', { count: 70, priceGrowth: -8 });
      await updateChainStatus(db);
      await updateChainStatus(db);

      // Only inactive→activated triggers messages, not transmitting→activated
      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'chain_activation'`
      ).all();
      expect(messages.length).toBe(0);
    });

    it('should send messages to multiple active users on activation', async () => {
      const user1 = seedUser(db, true);
      const user2 = seedUser(db, true);
      seedUser(db, false); // inactive user

      // First run: gold is bottom rank (inactive)
      seedKlineData(db, '518880', { count: 70, priceGrowth: -10 });
      seedKlineData(db, '161226', { count: 70, priceGrowth: 20 });
      seedKlineData(db, '512400', { count: 70, priceGrowth: 15 });
      seedKlineData(db, '515220', { count: 70, priceGrowth: 10 });
      seedKlineData(db, '516020', { count: 70, priceGrowth: 5 });
      seedKlineData(db, '159886', { count: 70, priceGrowth: 0 });
      seedKlineData(db, '161129', { count: 70, priceGrowth: -5 });
      await updateChainStatus(db);

      // Second run: gold jumps to top (activated)
      db.prepare('DELETE FROM market_history').run();
      seedKlineData(db, '518880', { count: 70, priceGrowth: 50 });
      seedKlineData(db, '161226', { count: 70, priceGrowth: 20 });
      seedKlineData(db, '512400', { count: 70, priceGrowth: 15 });
      seedKlineData(db, '515220', { count: 70, priceGrowth: 10 });
      seedKlineData(db, '516020', { count: 70, priceGrowth: 5 });
      seedKlineData(db, '159886', { count: 70, priceGrowth: 0 });
      seedKlineData(db, '161129', { count: 70, priceGrowth: -5 });
      await updateChainStatus(db);
      await updateChainStatus(db);

      const messages = db.prepare(
        `SELECT * FROM messages WHERE type = 'chain_activation' AND stock_code = '518880'`
      ).all() as { user_id: number }[];

      // Only 2 active users should get messages
      expect(messages.length).toBe(2);
      const userIds = messages.map(m => m.user_id).sort();
      expect(userIds).toEqual([user1, user2].sort());
    });

    it('should handle no K-line data gracefully', async () => {
      // No data seeded at all — all nodes get 0 change
      const result = await updateChainStatus(db);

      expect(result.nodes).toHaveLength(7);
      // With ranking, even all-zero changes get distributed: 2 activated, 3 transmitting, 2 inactive
      let activated = 0, transmitting = 0, inactive = 0;
      for (const node of result.nodes) {
        expect(node.change10d).toBe(0);
        if (node.status === 'activated') activated++;
        else if (node.status === 'transmitting') transmitting++;
        else inactive++;
      }
      expect(activated).toBe(2);
      expect(transmitting).toBe(3);
      expect(inactive).toBe(2);
    });

    it('should use INSERT OR REPLACE to update existing rows', async () => {
      // First run
      seedKlineData(db, '518880', { count: 70, priceGrowth: 30 });
      seedKlineData(db, '161226', { count: 70, priceGrowth: 20 });
      seedKlineData(db, '512400', { count: 70, priceGrowth: 15 });
      seedKlineData(db, '515220', { count: 70, priceGrowth: 10 });
      seedKlineData(db, '516020', { count: 70, priceGrowth: 5 });
      seedKlineData(db, '159886', { count: 70, priceGrowth: -2 });
      seedKlineData(db, '161129', { count: 70, priceGrowth: -8 });
      await updateChainStatus(db);

      // Second run with different data
      db.prepare('DELETE FROM market_history').run();
      seedKlineData(db, '518880', { count: 70, priceGrowth: -5 });
      seedKlineData(db, '161226', { count: 70, priceGrowth: 25 });
      seedKlineData(db, '512400', { count: 70, priceGrowth: 18 });
      seedKlineData(db, '515220', { count: 70, priceGrowth: 12 });
      seedKlineData(db, '516020', { count: 70, priceGrowth: 8 });
      seedKlineData(db, '159886', { count: 70, priceGrowth: 3 });
      seedKlineData(db, '161129', { count: 70, priceGrowth: -3 });
      await updateChainStatus(db);

      // Should still have exactly 7 rows (not 14)
      const count = db.prepare('SELECT COUNT(*) as cnt FROM chain_status').get() as { cnt: number };
      expect(count.cnt).toBe(7);
    });
  });
});
