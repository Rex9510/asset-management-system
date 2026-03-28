import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  getSectorFromCode,
  getConcentration,
  checkConcentrationRisk,
  checkAllUsersConcentrationRisk,
  ConcentrationResult,
} from './concentrationService';

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

function insertPosition(
  db: Database.Database,
  userId: number,
  stockCode: string,
  stockName: string,
  shares: number,
  opts: { costPrice?: number; positionType?: string } = {}
): number {
  const result = db.prepare(
    `INSERT INTO positions (user_id, stock_code, stock_name, position_type, cost_price, shares, buy_date)
     VALUES (?, ?, ?, ?, ?, ?, '2024-01-01')`
  ).run(userId, stockCode, stockName, opts.positionType ?? 'holding', opts.costPrice ?? 10.0, shares);
  return result.lastInsertRowid as number;
}

function insertMarketCache(db: Database.Database, stockCode: string, price: number): void {
  db.prepare(
    `INSERT OR REPLACE INTO market_cache (stock_code, stock_name, price, change_percent, volume, updated_at)
     VALUES (?, ?, ?, 0, 1000000, datetime('now'))`
  ).run(stockCode, stockCode, price);
}

function getMessages(db: Database.Database, userId: number): Array<{ type: string; summary: string; detail: string }> {
  return db.prepare(
    'SELECT type, summary, detail FROM messages WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId) as Array<{ type: string; summary: string; detail: string }>;
}

beforeEach(() => {
  testDb = makeDb();
});

afterEach(() => {
  testDb.close();
});

// --- getSectorFromCode ---

describe('getSectorFromCode', () => {
  it('should map 688/689 to 科创板', () => {
    expect(getSectorFromCode('688001')).toBe('科创板');
    expect(getSectorFromCode('689009')).toBe('科创板');
  });

  it('should map 300/301 to 创业板', () => {
    expect(getSectorFromCode('300001')).toBe('创业板');
    expect(getSectorFromCode('301001')).toBe('创业板');
  });

  it('should map 600/601/603/605 to 沪市主板', () => {
    expect(getSectorFromCode('600000')).toBe('沪市主板');
    expect(getSectorFromCode('601398')).toBe('沪市主板');
    expect(getSectorFromCode('603288')).toBe('沪市主板');
    expect(getSectorFromCode('605001')).toBe('沪市主板');
  });

  it('should map 000/001/002/003 to 深市主板', () => {
    expect(getSectorFromCode('000001')).toBe('深市主板');
    expect(getSectorFromCode('001001')).toBe('深市主板');
    expect(getSectorFromCode('002001')).toBe('深市主板');
    expect(getSectorFromCode('003001')).toBe('深市主板');
  });

  it('should return 其他 for unknown prefixes', () => {
    expect(getSectorFromCode('900001')).toBe('其他');
    expect(getSectorFromCode('123456')).toBe('其他');
  });

  it('should return 其他 for empty or short codes', () => {
    expect(getSectorFromCode('')).toBe('其他');
    expect(getSectorFromCode('60')).toBe('其他');
  });
});

// --- getConcentration ---

describe('getConcentration', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
  });

  it('should return empty result when user has no positions', () => {
    const result = getConcentration(1, testDb);
    expect(result.sectors).toHaveLength(0);
    expect(result.totalValue).toBe(0);
    expect(result.riskWarning).toBeNull();
  });

  it('should calculate single sector at 100%', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100);
    insertMarketCache(testDb, '600000', 10.0);

    const result = getConcentration(1, testDb);

    expect(result.sectors).toHaveLength(1);
    expect(result.sectors[0].sector).toBe('沪市主板');
    expect(result.sectors[0].percentage).toBeCloseTo(100, 5);
    expect(result.sectors[0].stockCount).toBe(1);
    expect(result.sectors[0].totalValue).toBe(1000);
    expect(result.totalValue).toBe(1000);
    // 100% > 60%, so risk warning
    expect(result.riskWarning).not.toBeNull();
  });

  it('should calculate multiple sectors correctly', () => {
    // 沪市主板: 100 shares * 10 = 1000
    insertPosition(testDb, 1, '600000', '浦发银行', 100);
    insertMarketCache(testDb, '600000', 10.0);
    // 创业板: 200 shares * 20 = 4000
    insertPosition(testDb, 1, '300001', '特锐德', 200);
    insertMarketCache(testDb, '300001', 20.0);

    const result = getConcentration(1, testDb);

    expect(result.sectors).toHaveLength(2);
    expect(result.totalValue).toBe(5000);

    // Sorted by percentage descending
    expect(result.sectors[0].sector).toBe('创业板');
    expect(result.sectors[0].percentage).toBeCloseTo(80, 5);
    expect(result.sectors[1].sector).toBe('沪市主板');
    expect(result.sectors[1].percentage).toBeCloseTo(20, 5);

    // 创业板 80% > 60%
    expect(result.riskWarning).toContain('创业板');
    expect(result.riskWarning).toContain('80.0%');
  });

  it('should have percentages summing to 100%', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100);
    insertMarketCache(testDb, '600000', 10.0);
    insertPosition(testDb, 1, '300001', '特锐德', 50);
    insertMarketCache(testDb, '300001', 10.0);
    insertPosition(testDb, 1, '688001', '华兴源创', 30);
    insertMarketCache(testDb, '688001', 10.0);

    const result = getConcentration(1, testDb);

    const totalPercentage = result.sectors.reduce((sum, s) => sum + s.percentage, 0);
    expect(totalPercentage).toBeCloseTo(100, 5);
  });

  it('should not trigger risk warning when no sector exceeds 60%', () => {
    // Equal distribution: 3 sectors each ~33%
    insertPosition(testDb, 1, '600000', '浦发银行', 100);
    insertMarketCache(testDb, '600000', 10.0);
    insertPosition(testDb, 1, '300001', '特锐德', 100);
    insertMarketCache(testDb, '300001', 10.0);
    insertPosition(testDb, 1, '688001', '华兴源创', 100);
    insertMarketCache(testDb, '688001', 10.0);

    const result = getConcentration(1, testDb);

    expect(result.riskWarning).toBeNull();
  });

  it('should skip positions without market cache data', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100);
    // No market cache for 600000
    insertPosition(testDb, 1, '300001', '特锐德', 100);
    insertMarketCache(testDb, '300001', 10.0);

    const result = getConcentration(1, testDb);

    expect(result.sectors).toHaveLength(1);
    expect(result.sectors[0].sector).toBe('创业板');
    expect(result.sectors[0].percentage).toBeCloseTo(100, 5);
  });

  it('should skip watching positions', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100, { positionType: 'watching' });
    insertMarketCache(testDb, '600000', 10.0);

    const result = getConcentration(1, testDb);
    expect(result.sectors).toHaveLength(0);
    expect(result.totalValue).toBe(0);
  });

  it('should count multiple stocks in same sector', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100);
    insertMarketCache(testDb, '600000', 10.0);
    insertPosition(testDb, 1, '601398', '工商银行', 200);
    insertMarketCache(testDb, '601398', 5.0);

    const result = getConcentration(1, testDb);

    expect(result.sectors).toHaveLength(1);
    expect(result.sectors[0].sector).toBe('沪市主板');
    expect(result.sectors[0].stockCount).toBe(2);
    expect(result.sectors[0].totalValue).toBe(2000); // 100*10 + 200*5
  });

  it('should return empty when all positions have no market cache', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100);
    insertPosition(testDb, 1, '300001', '特锐德', 100);

    const result = getConcentration(1, testDb);
    expect(result.sectors).toHaveLength(0);
    expect(result.totalValue).toBe(0);
  });
});

// --- checkConcentrationRisk ---

describe('checkConcentrationRisk', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
  });

  it('should create concentration_risk message when sector > 60%', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100);
    insertMarketCache(testDb, '600000', 10.0);

    checkConcentrationRisk(1, testDb);

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('concentration_risk');
    expect(msgs[0].summary).toBe('持仓集中度风险提示');

    const detail = JSON.parse(msgs[0].detail);
    expect(detail.riskSector).toBe('沪市主板');
    expect(detail.percentage).toBeCloseTo(100, 5);
  });

  it('should not create message when no sector exceeds 60%', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100);
    insertMarketCache(testDb, '600000', 10.0);
    insertPosition(testDb, 1, '300001', '特锐德', 100);
    insertMarketCache(testDb, '300001', 10.0);
    insertPosition(testDb, 1, '688001', '华兴源创', 100);
    insertMarketCache(testDb, '688001', 10.0);

    checkConcentrationRisk(1, testDb);

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(0);
  });

  it('should not duplicate message within 24 hours', () => {
    insertPosition(testDb, 1, '600000', '浦发银行', 100);
    insertMarketCache(testDb, '600000', 10.0);

    checkConcentrationRisk(1, testDb);
    checkConcentrationRisk(1, testDb);

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(1);
  });

  it('should not create message when user has no positions', () => {
    checkConcentrationRisk(1, testDb);

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(0);
  });
});

// --- checkAllUsersConcentrationRisk ---

describe('checkAllUsersConcentrationRisk', () => {
  it('should check concentration for all users with holdings', () => {
    insertUser(testDb, 1);
    insertUser(testDb, 2);

    // User 1: single sector (100% concentration)
    insertPosition(testDb, 1, '600000', '浦发银行', 100);
    insertMarketCache(testDb, '600000', 10.0);

    // User 2: single sector (100% concentration)
    insertPosition(testDb, 2, '300001', '特锐德', 100);
    insertMarketCache(testDb, '300001', 20.0);

    checkAllUsersConcentrationRisk(testDb);

    const msgs1 = getMessages(testDb, 1);
    const msgs2 = getMessages(testDb, 2);
    expect(msgs1).toHaveLength(1);
    expect(msgs1[0].type).toBe('concentration_risk');
    expect(msgs2).toHaveLength(1);
    expect(msgs2[0].type).toBe('concentration_risk');
  });

  it('should handle users with no risk', () => {
    insertUser(testDb, 1);

    // Balanced portfolio
    insertPosition(testDb, 1, '600000', '浦发银行', 100);
    insertMarketCache(testDb, '600000', 10.0);
    insertPosition(testDb, 1, '300001', '特锐德', 100);
    insertMarketCache(testDb, '300001', 10.0);
    insertPosition(testDb, 1, '688001', '华兴源创', 100);
    insertMarketCache(testDb, '688001', 10.0);

    checkAllUsersConcentrationRisk(testDb);

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(0);
  });
});
