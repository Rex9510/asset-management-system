import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  findLowPositionCandidates,
  generateAmbushRecommendation,
  triggerAmbushOnClearance,
  parseAIAmbushResponse,
  LowPositionCandidate,
} from './ambushService';

let testDb: Database.Database;
let mockChat: jest.Mock;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

jest.mock('../ai/aiProviderFactory', () => ({
  getAIProvider: () => ({
    chat: (...args: unknown[]) => mockChat(...args),
    analyze: jest.fn(),
    getModelName: () => 'test-model',
  }),
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

function insertHS300(db: Database.Database, stockCode: string, stockName: string, weight: number): void {
  db.prepare('INSERT INTO hs300_constituents (stock_code, stock_name, weight) VALUES (?, ?, ?)').run(stockCode, stockName, weight);
}

function insertIndicator(
  db: Database.Database,
  stockCode: string,
  opts: { rsi6: number; ma20: number; dif: number; dea: number; macdHistogram: number }
): void {
  db.prepare(
    `INSERT INTO technical_indicators (stock_code, trade_date, rsi6, ma20, dif, dea, macd_histogram)
     VALUES (?, '2024-01-10', ?, ?, ?, ?, ?)`
  ).run(stockCode, opts.rsi6, opts.ma20, opts.dif, opts.dea, opts.macdHistogram);
}

function insertMarketHistory(db: Database.Database, stockCode: string, closePrice: number): void {
  db.prepare(
    `INSERT INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
     VALUES (?, '2024-01-10', ?, ?, ?, ?, 1000000)`
  ).run(stockCode, closePrice, closePrice, closePrice + 0.5, closePrice - 0.5);
}

function getMessages(db: Database.Database, userId: number): Array<{ type: string; stock_code: string; stock_name: string; summary: string; detail: string }> {
  return db.prepare(
    `SELECT type, stock_code, stock_name, summary, detail FROM messages WHERE user_id = ? ORDER BY created_at DESC`
  ).all(userId) as Array<{ type: string; stock_code: string; stock_name: string; summary: string; detail: string }>;
}

/**
 * Insert a stock that qualifies as a low-position candidate:
 * RSI6 < 35, price below MA20, MACD near golden cross
 */
function insertLowPositionStock(
  db: Database.Database,
  stockCode: string,
  stockName: string,
  weight: number,
  closePrice: number,
  rsi6: number
): void {
  insertHS300(db, stockCode, stockName, weight);
  insertMarketHistory(db, stockCode, closePrice);
  insertIndicator(db, stockCode, {
    rsi6,
    ma20: closePrice * 1.1, // Price is ~10% below MA20
    dif: -0.02,
    dea: 0.01,
    macdHistogram: -0.03, // Near golden cross from below
  });
}

beforeEach(() => {
  testDb = makeDb();
  mockChat = jest.fn();
});

afterEach(() => {
  testDb.close();
});

// --- findLowPositionCandidates ---

describe('findLowPositionCandidates', () => {
  it('should return candidates that meet all low-position criteria', () => {
    insertLowPositionStock(testDb, '600000', '浦发银行', 1.5, 10.0, 25);

    const candidates = findLowPositionCandidates(testDb);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].stockCode).toBe('600000');
    expect(candidates[0].rsi6).toBe(25);
    expect(candidates[0].latestClose).toBe(10.0);
  });

  it('should exclude stocks with RSI >= 35', () => {
    insertHS300(testDb, '600000', '浦发银行', 1.5);
    insertMarketHistory(testDb, '600000', 10.0);
    insertIndicator(testDb, '600000', {
      rsi6: 40, // Not oversold
      ma20: 11.0,
      dif: -0.02,
      dea: 0.01,
      macdHistogram: -0.03,
    });

    const candidates = findLowPositionCandidates(testDb);
    expect(candidates).toHaveLength(0);
  });

  it('should exclude stocks with price at or above MA20', () => {
    insertHS300(testDb, '600000', '浦发银行', 1.5);
    insertMarketHistory(testDb, '600000', 12.0);
    insertIndicator(testDb, '600000', {
      rsi6: 25,
      ma20: 11.0, // Price above MA20
      dif: -0.02,
      dea: 0.01,
      macdHistogram: -0.03,
    });

    const candidates = findLowPositionCandidates(testDb);
    expect(candidates).toHaveLength(0);
  });

  it('should exclude stocks where MACD is not near golden cross', () => {
    insertHS300(testDb, '600000', '浦发银行', 1.5);
    insertMarketHistory(testDb, '600000', 10.0);
    insertIndicator(testDb, '600000', {
      rsi6: 25,
      ma20: 11.0,
      dif: -0.5,
      dea: 0.3, // Gap too large, not near cross
      macdHistogram: -0.8,
    });

    const candidates = findLowPositionCandidates(testDb);
    expect(candidates).toHaveLength(0);
  });

  it('should include stocks with MACD golden cross (small positive histogram)', () => {
    insertHS300(testDb, '600000', '浦发银行', 1.5);
    insertMarketHistory(testDb, '600000', 10.0);
    insertIndicator(testDb, '600000', {
      rsi6: 25,
      ma20: 11.0,
      dif: 0.05,
      dea: 0.02, // DIF > DEA, golden cross
      macdHistogram: 0.1,
    });

    const candidates = findLowPositionCandidates(testDb);
    expect(candidates).toHaveLength(1);
  });

  it('should sort candidates by oversold score (most oversold first)', () => {
    insertLowPositionStock(testDb, '600000', '浦发银行', 1.5, 10.0, 30);
    insertLowPositionStock(testDb, '600036', '招商银行', 2.0, 35.0, 20);
    insertLowPositionStock(testDb, '601318', '中国平安', 3.0, 50.0, 25);

    const candidates = findLowPositionCandidates(testDb);

    expect(candidates).toHaveLength(3);
    expect(candidates[0].stockCode).toBe('600036'); // RSI 20 (most oversold)
    expect(candidates[1].stockCode).toBe('601318'); // RSI 25
    expect(candidates[2].stockCode).toBe('600000'); // RSI 30
  });

  it('should return empty array when no HS300 constituents exist', () => {
    const candidates = findLowPositionCandidates(testDb);
    expect(candidates).toHaveLength(0);
  });

  it('should return at most 10 candidates', () => {
    for (let i = 0; i < 15; i++) {
      const code = `60000${i.toString().padStart(1, '0')}`;
      insertLowPositionStock(testDb, code, `Stock${i}`, 1.0, 10.0, 20 + i);
    }

    const candidates = findLowPositionCandidates(testDb);
    expect(candidates.length).toBeLessThanOrEqual(10);
  });
});


// --- parseAIAmbushResponse ---

describe('parseAIAmbushResponse', () => {
  const mockCandidates: LowPositionCandidate[] = [
    {
      stockCode: '600000',
      stockName: '浦发银行',
      weight: 1.5,
      latestClose: 10.0,
      rsi6: 25,
      ma20: 11.0,
      dif: -0.02,
      dea: 0.01,
      macdHistogram: -0.03,
      oversoldScore: 25,
    },
    {
      stockCode: '600036',
      stockName: '招商银行',
      weight: 2.0,
      latestClose: 35.0,
      rsi6: 20,
      ma20: 38.0,
      dif: -0.01,
      dea: 0.02,
      macdHistogram: -0.03,
      oversoldScore: 20,
    },
  ];

  it('should parse valid AI JSON response', () => {
    const aiResponse = JSON.stringify([
      {
        stockCode: '600000',
        stockName: '浦发银行',
        lowPositionReason: 'RSI超卖，技术面见底',
        reboundPotential: '预估反弹10%',
        buyPriceLow: 9.5,
        buyPriceHigh: 10.2,
        holdingPeriodRef: '参考持仓2-3周',
      },
      {
        stockCode: '600036',
        stockName: '招商银行',
        lowPositionReason: 'MACD底背离',
        reboundPotential: '预估反弹8%',
        buyPriceLow: 33.0,
        buyPriceHigh: 35.5,
        holdingPeriodRef: '参考持仓3-4周',
      },
    ]);

    const result = parseAIAmbushResponse(aiResponse, mockCandidates);

    expect(result).toHaveLength(2);
    expect(result[0].stockCode).toBe('600000');
    expect(result[0].lowPositionReason).toBe('RSI超卖，技术面见底');
    expect(result[0].buyPriceRange.low).toBe(9.5);
    expect(result[0].buyPriceRange.high).toBe(10.2);
    expect(result[1].stockCode).toBe('600036');
  });

  it('should use fallback when AI response is invalid JSON', () => {
    const result = parseAIAmbushResponse('invalid json', mockCandidates);

    expect(result).toHaveLength(2);
    expect(result[0].stockCode).toBe('600000');
    expect(result[0].lowPositionReason).toContain('RSI6');
  });

  it('should use fallback values for missing fields', () => {
    const aiResponse = JSON.stringify([
      { stockCode: '600000' },
    ]);

    const result = parseAIAmbushResponse(aiResponse, mockCandidates);

    expect(result).toHaveLength(1);
    expect(result[0].stockCode).toBe('600000');
    expect(result[0].stockName).toBe('浦发银行');
    expect(result[0].lowPositionReason).toContain('RSI6');
    expect(result[0].buyPriceRange.low).toBeGreaterThan(0);
    expect(result[0].holdingPeriodRef).toContain('参考持仓');
  });

  it('should skip stocks not in candidates list', () => {
    const aiResponse = JSON.stringify([
      { stockCode: '999999', stockName: '不存在', lowPositionReason: 'test' },
    ]);

    const result = parseAIAmbushResponse(aiResponse, mockCandidates);

    // Falls back since no valid items parsed
    expect(result).toHaveLength(2);
    expect(result[0].stockCode).toBe('600000');
  });

  it('should limit to 2 recommendations', () => {
    const aiResponse = JSON.stringify([
      { stockCode: '600000', stockName: '浦发银行', lowPositionReason: 'r1', reboundPotential: 'p1', buyPriceLow: 9.5, buyPriceHigh: 10.2, holdingPeriodRef: 'h1' },
      { stockCode: '600036', stockName: '招商银行', lowPositionReason: 'r2', reboundPotential: 'p2', buyPriceLow: 33, buyPriceHigh: 35, holdingPeriodRef: 'h2' },
      { stockCode: '600036', stockName: '招商银行', lowPositionReason: 'r3', reboundPotential: 'p3', buyPriceLow: 33, buyPriceHigh: 35, holdingPeriodRef: 'h3' },
    ]);

    const result = parseAIAmbushResponse(aiResponse, mockCandidates);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});

// --- generateAmbushRecommendation ---

describe('generateAmbushRecommendation', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
  });

  it('should generate recommendations and store in messages table', async () => {
    insertLowPositionStock(testDb, '600000', '浦发银行', 1.5, 10.0, 25);

    mockChat.mockResolvedValue(JSON.stringify([
      {
        stockCode: '600000',
        stockName: '浦发银行',
        lowPositionReason: 'RSI超卖，技术面见底',
        reboundPotential: '预估反弹10%',
        buyPriceLow: 9.5,
        buyPriceHigh: 10.2,
        holdingPeriodRef: '参考持仓2-3周',
      },
    ]));

    const result = await generateAmbushRecommendation(1, testDb);

    expect(result).toHaveLength(1);
    expect(result[0].stockCode).toBe('600000');

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('ambush_recommendation');
    expect(msgs[0].stock_code).toBe('600000');
    expect(msgs[0].summary).toContain('埋伏参考');
  });

  it('should return empty array when no candidates found', async () => {
    const result = await generateAmbushRecommendation(1, testDb);
    expect(result).toHaveLength(0);
  });

  it('should use fallback when AI call fails', async () => {
    insertLowPositionStock(testDb, '600000', '浦发银行', 1.5, 10.0, 25);

    mockChat.mockRejectedValue(new Error('AI service unavailable'));

    const result = await generateAmbushRecommendation(1, testDb);

    expect(result).toHaveLength(1);
    expect(result[0].stockCode).toBe('600000');
    expect(result[0].lowPositionReason).toContain('RSI6');

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('ambush_recommendation');
  });

  it('should generate up to 2 recommendations', async () => {
    insertLowPositionStock(testDb, '600000', '浦发银行', 1.5, 10.0, 25);
    insertLowPositionStock(testDb, '600036', '招商银行', 2.0, 35.0, 20);
    insertLowPositionStock(testDb, '601318', '中国平安', 3.0, 50.0, 22);

    mockChat.mockResolvedValue(JSON.stringify([
      { stockCode: '600036', stockName: '招商银行', lowPositionReason: 'r1', reboundPotential: 'p1', buyPriceLow: 33, buyPriceHigh: 35, holdingPeriodRef: 'h1' },
      { stockCode: '601318', stockName: '中国平安', lowPositionReason: 'r2', reboundPotential: 'p2', buyPriceLow: 48, buyPriceHigh: 50, holdingPeriodRef: 'h2' },
    ]));

    const result = await generateAmbushRecommendation(1, testDb);

    expect(result).toHaveLength(2);

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(2);
  });
});

// --- triggerAmbushOnClearance ---

describe('triggerAmbushOnClearance', () => {
  beforeEach(() => {
    insertUser(testDb, 1);
  });

  it('should trigger ambush recommendation on clearance', async () => {
    insertLowPositionStock(testDb, '600000', '浦发银行', 1.5, 10.0, 25);

    mockChat.mockResolvedValue(JSON.stringify([
      {
        stockCode: '600000',
        stockName: '浦发银行',
        lowPositionReason: 'RSI超卖',
        reboundPotential: '预估反弹10%',
        buyPriceLow: 9.5,
        buyPriceHigh: 10.2,
        holdingPeriodRef: '参考持仓2-3周',
      },
    ]));

    const result = await triggerAmbushOnClearance(1, '600036', testDb);

    expect(result).toHaveLength(1);
    expect(result[0].stockCode).toBe('600000');

    const msgs = getMessages(testDb, 1);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('ambush_recommendation');
  });
});
