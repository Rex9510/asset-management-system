import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  checkMACDCondition,
  checkRSICondition,
  checkVolumeExpansion,
  checkPriceNearMA20,
  filterCandidates,
  generateDailyPicks,
  parseAIPicksResponse,
  CandidateStock,
  DailyPick,
} from './dailyPickService';
import { MarketHistoryRow } from '../indicators/indicatorService';

let testDb: Database.Database;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

jest.mock('../ai/aiProviderFactory', () => ({
  getAIProvider: () => ({
    chat: jest.fn().mockResolvedValue(JSON.stringify([
      { stockCode: '600000', stockName: '浦发银行', period: 'short', reason: '技术面MACD金叉；基本面估值偏低', targetPriceLow: 10.5, targetPriceHigh: 11.5, estimatedUpside: 10 },
      { stockCode: '600036', stockName: '招商银行', period: 'mid', reason: '趋势向好；资金面持续流入', targetPriceLow: 35, targetPriceHigh: 40, estimatedUpside: 15 },
      { stockCode: '601318', stockName: '中国平安', period: 'long', reason: '价值低估；行业龙头地位稳固', targetPriceLow: 55, targetPriceHigh: 65, estimatedUpside: 20 },
    ])),
    getModelName: () => 'mock-model',
  }),
}));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function makeHistoryRow(overrides: Partial<MarketHistoryRow> & { trade_date: string }): MarketHistoryRow {
  return {
    open_price: 10,
    close_price: 10,
    high_price: 10.5,
    low_price: 9.5,
    volume: 1000000,
    ...overrides,
  };
}

function insertMarketHistory(db: Database.Database, stockCode: string, rows: MarketHistoryRow[]): void {
  const stmt = db.prepare(
    `INSERT INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of rows) {
    stmt.run(stockCode, r.trade_date, r.open_price, r.close_price, r.high_price, r.low_price, r.volume);
  }
}

function insertHS300(db: Database.Database, stockCode: string, stockName: string, weight: number): void {
  db.prepare('INSERT INTO hs300_constituents (stock_code, stock_name, weight) VALUES (?, ?, ?)').run(stockCode, stockName, weight);
}

function insertIndicator(db: Database.Database, stockCode: string, tradeDate: string, overrides: Record<string, number | null> = {}): void {
  const defaults = { dif: 0.1, dea: 0.05, rsi12: 50, ma20: 10, ma5: 10, ma10: 10, ma60: 10, macd_histogram: 0.1, k_value: 50, d_value: 50, j_value: 50, rsi6: 50, rsi24: 50 };
  const vals = { ...defaults, ...overrides };
  db.prepare(
    `INSERT INTO technical_indicators (stock_code, trade_date, ma5, ma10, ma20, ma60, dif, dea, macd_histogram, k_value, d_value, j_value, rsi6, rsi12, rsi24)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(stockCode, tradeDate, vals.ma5, vals.ma10, vals.ma20, vals.ma60, vals.dif, vals.dea, vals.macd_histogram, vals.k_value, vals.d_value, vals.j_value, vals.rsi6, vals.rsi12, vals.rsi24);
}

function insertUser(db: Database.Database, userId: number): void {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(userId, `user${userId}`, 'hash');
}

// Helper: create a stock with all conditions met (good candidate)
// Data is designed to NOT trigger any risk alerts:
// - close ≈ midpoint of (open+high+low)/3 to avoid late session anomaly
// - volume increase is gradual (not divergent with price)
// - no false breakout pattern
function setupGoodCandidate(db: Database.Database, stockCode: string, stockName: string, weight: number): void {
  insertHS300(db, stockCode, stockName, weight);
  // DIF > DEA (golden cross), RSI in range, MA20 = 10
  insertIndicator(db, stockCode, '2024-01-10', { dif: 0.1, dea: 0.05, rsi12: 55, ma20: 10 });
  // 10 days of history: first 5 with lower volume, last 5 with higher volume
  // Use symmetric OHLC so close ≈ midpoint to avoid late session anomaly
  const rows: MarketHistoryRow[] = [];
  for (let i = 0; i < 5; i++) {
    rows.push(makeHistoryRow({
      trade_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      volume: 800000,
      open_price: 10,
      close_price: 10.1,
      high_price: 10.3,
      low_price: 10,
    }));
  }
  for (let i = 5; i < 10; i++) {
    // close = 10.2, midpoint = (10.1+10.3+10.0)/3 = 10.133, lateMove = 0.067
    // dailyChange = 10.2 - 10.1 = 0.1, ratio = 0.67 > 0.5 still triggers!
    // Instead: open=10.1, close=10.15, high=10.25, low=10.0
    // midpoint = (10.1+10.25+10.0)/3 = 10.1167, lateMove = 10.15-10.1167 = 0.033
    // dailyChange = 10.15-10.1 = 0.05, ratio = 0.033/0.05 = 0.67 still > 0.5
    // Need: close very close to midpoint. Use open=10, close=10.1, high=10.2, low=9.9
    // midpoint = (10+10.2+9.9)/3 = 10.033, lateMove = 10.1-10.033 = 0.067
    // dailyChange = 10.1-10 = 0.1, ratio = 0.067/0.1 = 0.67 still > 0.5
    // The only way to avoid: make dailyChange very small (< 0.005 * open)
    // open=10.1, close=10.14, high=10.2, low=10.05
    // dailyChange = 0.04, dailyChange/open = 0.004 < 0.005 → returns null!
    rows.push(makeHistoryRow({
      trade_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      volume: 1200000,
      open_price: 10.1,
      close_price: 10.14,
      high_price: 10.2,
      low_price: 10.05,
    }));
  }
  insertMarketHistory(db, stockCode, rows);
}

// --- Pure function tests ---

describe('checkMACDCondition', () => {
  it('should return goldenCross=true when DIF > DEA', () => {
    const result = checkMACDCondition(0.1, 0.05);
    expect(result.goldenCross).toBe(true);
    expect(result.nearCross).toBe(false);
  });

  it('should return nearCross=true when DIF is just below DEA', () => {
    const result = checkMACDCondition(0.03, 0.05);
    expect(result.goldenCross).toBe(false);
    expect(result.nearCross).toBe(true);
  });

  it('should return both false when DIF is far below DEA', () => {
    const result = checkMACDCondition(-0.1, 0.05);
    expect(result.goldenCross).toBe(false);
    expect(result.nearCross).toBe(false);
  });

  it('should return both false when values are null', () => {
    const result = checkMACDCondition(null, null);
    expect(result.goldenCross).toBe(false);
    expect(result.nearCross).toBe(false);
  });
});

describe('checkRSICondition', () => {
  it('should return true for RSI in 30-70 range', () => {
    expect(checkRSICondition(50)).toBe(true);
    expect(checkRSICondition(30)).toBe(true);
    expect(checkRSICondition(70)).toBe(true);
  });

  it('should return false for RSI outside range', () => {
    expect(checkRSICondition(29)).toBe(false);
    expect(checkRSICondition(71)).toBe(false);
  });

  it('should return false for null', () => {
    expect(checkRSICondition(null)).toBe(false);
  });
});

describe('checkVolumeExpansion', () => {
  it('should return true when recent 5-day avg volume > prior 5-day avg by >10%', () => {
    const rows: MarketHistoryRow[] = [];
    for (let i = 0; i < 5; i++) {
      rows.push(makeHistoryRow({ trade_date: `2024-01-0${i + 1}`, volume: 1000000 }));
    }
    for (let i = 5; i < 10; i++) {
      rows.push(makeHistoryRow({ trade_date: `2024-01-${i + 1}`, volume: 1200000 }));
    }
    expect(checkVolumeExpansion(rows)).toBe(true);
  });

  it('should return false when volume did not expand enough', () => {
    const rows: MarketHistoryRow[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(makeHistoryRow({ trade_date: `2024-01-${String(i + 1).padStart(2, '0')}`, volume: 1000000 }));
    }
    expect(checkVolumeExpansion(rows)).toBe(false);
  });

  it('should return false with insufficient data', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeHistoryRow({ trade_date: `2024-01-0${i + 1}` })
    );
    expect(checkVolumeExpansion(rows)).toBe(false);
  });
});

describe('checkPriceNearMA20', () => {
  it('should return true when price is above MA20', () => {
    expect(checkPriceNearMA20(10.5, 10)).toBe(true);
  });

  it('should return true when price is within 3% below MA20', () => {
    expect(checkPriceNearMA20(9.8, 10)).toBe(true); // -2%
  });

  it('should return false when price is more than 3% below MA20', () => {
    expect(checkPriceNearMA20(9.5, 10)).toBe(false); // -5%
  });

  it('should return false when MA20 is null', () => {
    expect(checkPriceNearMA20(10, null)).toBe(false);
  });
});

// --- Integration tests ---

describe('filterCandidates', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it('should return empty array when no HS300 constituents', () => {
    expect(filterCandidates(testDb)).toEqual([]);
  });

  it('should return candidates that meet at least 3 conditions', () => {
    setupGoodCandidate(testDb, '600000', '浦发银行', 1.5);
    const result = filterCandidates(testDb);
    expect(result.length).toBe(1);
    expect(result[0].stockCode).toBe('600000');
    expect(result[0].matchCount).toBeGreaterThanOrEqual(3);
  });

  it('should exclude stocks that meet fewer than 3 conditions', () => {
    insertHS300(testDb, '600001', '测试股票', 1.0);
    // RSI out of range, no golden cross
    insertIndicator(testDb, '600001', '2024-01-10', { dif: -0.5, dea: 0.1, rsi12: 80, ma20: 15 });
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeHistoryRow({ trade_date: `2024-01-${String(i + 1).padStart(2, '0')}`, close_price: 10, volume: 1000000 })
    );
    insertMarketHistory(testDb, '600001', rows);

    expect(filterCandidates(testDb)).toEqual([]);
  });

  it('should exclude stocks with risk alerts', () => {
    insertHS300(testDb, '600000', '浦发银行', 1.5);
    insertIndicator(testDb, '600000', '2024-01-22', { dif: 0.1, dea: 0.05, rsi12: 55, ma20: 10 });

    // Create history that triggers volume divergence risk (volume up, price down)
    const rows: MarketHistoryRow[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push(makeHistoryRow({
        trade_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        volume: 800000,
        close_price: 10,
        open_price: 10,
        high_price: 10.2,
        low_price: 9.8,
      }));
    }
    // Day 21: breakout
    rows.push(makeHistoryRow({ trade_date: '2024-01-21', open_price: 10.2, close_price: 10.5, high_price: 10.6, low_price: 10.1, volume: 800000 }));
    // Day 22: false breakout + volume divergence (high volume, price drops)
    rows.push(makeHistoryRow({ trade_date: '2024-01-22', open_price: 10.3, close_price: 9.8, high_price: 10.4, low_price: 9.7, volume: 1500000 }));
    insertMarketHistory(testDb, '600000', rows);

    const result = filterCandidates(testDb);
    expect(result.length).toBe(0);
  });

  it('should sort candidates by matchCount desc then weight desc', () => {
    setupGoodCandidate(testDb, '600000', '浦发银行', 1.5);
    setupGoodCandidate(testDb, '600036', '招商银行', 3.0);

    const result = filterCandidates(testDb);
    expect(result.length).toBe(2);
    // Same matchCount, so sorted by weight desc
    expect(result[0].stockCode).toBe('600036');
    expect(result[1].stockCode).toBe('600000');
  });
});


describe('parseAIPicksResponse', () => {
  const mockCandidates: CandidateStock[] = [
    { stockCode: '600000', stockName: '浦发银行', weight: 1.5, latestClose: 10, matchCount: 4, indicators: { macdGoldenCross: true, macdNearCross: false, rsiInRange: true, volumeExpanding: true, priceAboveMA20: true } },
    { stockCode: '600036', stockName: '招商银行', weight: 3.0, latestClose: 32, matchCount: 3, indicators: { macdGoldenCross: true, macdNearCross: false, rsiInRange: true, volumeExpanding: true, priceAboveMA20: false } },
    { stockCode: '601318', stockName: '中国平安', weight: 2.5, latestClose: 50, matchCount: 3, indicators: { macdGoldenCross: false, macdNearCross: true, rsiInRange: true, volumeExpanding: true, priceAboveMA20: true } },
  ];

  it('should parse valid AI response with 3 picks', () => {
    const response = JSON.stringify([
      { stockCode: '600000', stockName: '浦发银行', period: 'short', reason: '技术面MACD金叉；基本面估值偏低', targetPriceLow: 10.5, targetPriceHigh: 11.5, estimatedUpside: 10 },
      { stockCode: '600036', stockName: '招商银行', period: 'mid', reason: '趋势向好；资金面持续流入', targetPriceLow: 35, targetPriceHigh: 40, estimatedUpside: 15 },
      { stockCode: '601318', stockName: '中国平安', period: 'long', reason: '价值低估；行业龙头地位稳固', targetPriceLow: 55, targetPriceHigh: 65, estimatedUpside: 20 },
    ]);

    const picks = parseAIPicksResponse(response, mockCandidates);
    expect(picks).toHaveLength(3);
    expect(picks[0].period).toBe('short');
    expect(picks[1].period).toBe('mid');
    expect(picks[2].period).toBe('long');
    expect(picks[0].targetPriceRange.low).toBe(10.5);
    expect(picks[2].estimatedUpside).toBe(20);
  });

  it('should fill missing periods from candidates', () => {
    const response = JSON.stringify([
      { stockCode: '600000', stockName: '浦发银行', period: 'short', reason: '技术面好', targetPriceLow: 10.5, targetPriceHigh: 11.5, estimatedUpside: 10 },
    ]);

    const picks = parseAIPicksResponse(response, mockCandidates);
    expect(picks).toHaveLength(3);
    const periods = picks.map(p => p.period);
    expect(periods).toContain('short');
    expect(periods).toContain('mid');
    expect(periods).toContain('long');
  });

  it('should fallback to candidates when AI response is invalid', () => {
    const picks = parseAIPicksResponse('invalid json', mockCandidates);
    expect(picks).toHaveLength(3);
    expect(picks[0].period).toBe('short');
    expect(picks[1].period).toBe('mid');
    expect(picks[2].period).toBe('long');
  });

  it('should skip duplicate periods', () => {
    const response = JSON.stringify([
      { stockCode: '600000', stockName: '浦发银行', period: 'short', reason: 'r1', targetPriceLow: 10.5, targetPriceHigh: 11.5, estimatedUpside: 10 },
      { stockCode: '600036', stockName: '招商银行', period: 'short', reason: 'r2', targetPriceLow: 35, targetPriceHigh: 40, estimatedUpside: 15 },
      { stockCode: '601318', stockName: '中国平安', period: 'long', reason: 'r3', targetPriceLow: 55, targetPriceHigh: 65, estimatedUpside: 20 },
    ]);

    const picks = parseAIPicksResponse(response, mockCandidates);
    // Should have short, long from AI, and mid filled from candidates
    expect(picks).toHaveLength(3);
    const periods = picks.map(p => p.period).sort();
    expect(periods).toEqual(['long', 'mid', 'short']);
  });

  it('should reject stocks not in candidate list', () => {
    const response = JSON.stringify([
      { stockCode: '999999', stockName: '不存在', period: 'short', reason: 'r1', targetPriceLow: 10, targetPriceHigh: 11, estimatedUpside: 10 },
    ]);

    const picks = parseAIPicksResponse(response, mockCandidates);
    // Should fallback to fill all 3 from candidates
    expect(picks).toHaveLength(3);
    expect(picks.every(p => mockCandidates.some(c => c.stockCode === p.stockCode))).toBe(true);
  });
});

describe('generateDailyPicks', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it('should return empty array when no candidates', async () => {
    insertUser(testDb, 1);
    const picks = await generateDailyPicks(1, testDb);
    expect(picks).toEqual([]);
  });

  it('should generate picks and store in messages table', async () => {
    insertUser(testDb, 1);
    setupGoodCandidate(testDb, '600000', '浦发银行', 1.5);
    setupGoodCandidate(testDb, '600036', '招商银行', 3.0);
    setupGoodCandidate(testDb, '601318', '中国平安', 2.5);

    const picks = await generateDailyPicks(1, testDb);
    expect(picks.length).toBeGreaterThan(0);

    // Check messages were stored
    const messages = testDb.prepare("SELECT * FROM messages WHERE user_id = 1 AND type = 'daily_pick'").all() as any[];
    expect(messages.length).toBe(picks.length);
    for (const msg of messages) {
      expect(msg.type).toBe('daily_pick');
      expect(msg.is_read).toBe(0);
      expect(msg.summary).toBeTruthy();
      expect(msg.detail).toBeTruthy();
    }
  });

  it('should include period labels in picks', async () => {
    insertUser(testDb, 1);
    setupGoodCandidate(testDb, '600000', '浦发银行', 1.5);
    setupGoodCandidate(testDb, '600036', '招商银行', 3.0);
    setupGoodCandidate(testDb, '601318', '中国平安', 2.5);

    const picks = await generateDailyPicks(1, testDb);
    for (const pick of picks) {
      expect(['short', 'mid', 'long']).toContain(pick.period);
      expect(pick.periodLabel).toBeTruthy();
      expect(pick.targetPriceRange.low).toBeGreaterThan(0);
      expect(pick.targetPriceRange.high).toBeGreaterThan(pick.targetPriceRange.low);
      expect(pick.estimatedUpside).toBeGreaterThan(0);
    }
  });
});
