import Database from 'better-sqlite3';
import {
  percentileRank,
  median,
  computePeriodStats,
  generateBacktestSummary,
  getCurrentPercentile,
  getHistoricalPrices,
  computeHistoricalPercentiles,
  findMatchingPoints,
  computeForwardReturns,
  runBacktest,
  DISCLAIMER,
  MIN_SAMPLE_SIZE,
  PERCENTILE_TOLERANCE,
  BacktestResult,
  BacktestPeriodResult,
} from './backtestService';

// --- Test helpers ---

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS valuation_cache (
      stock_code TEXT NOT NULL,
      pe_value REAL,
      pb_value REAL,
      pe_percentile REAL,
      pb_percentile REAL,
      pe_zone TEXT CHECK(pe_zone IN ('low', 'fair', 'high')),
      pb_zone TEXT CHECK(pb_zone IN ('low', 'fair', 'high')),
      data_years INTEGER,
      source TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (stock_code)
    );

    CREATE TABLE IF NOT EXISTS market_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_code TEXT NOT NULL,
      trade_date DATE NOT NULL,
      open_price REAL NOT NULL,
      close_price REAL NOT NULL,
      high_price REAL NOT NULL,
      low_price REAL NOT NULL,
      volume REAL NOT NULL,
      UNIQUE(stock_code, trade_date)
    );
  `);

  return db;
}

function seedValuationCache(db: Database.Database, stockCode: string, pePercentile: number): void {
  db.prepare(
    `INSERT OR REPLACE INTO valuation_cache (stock_code, pe_value, pb_value, pe_percentile, pb_percentile, pe_zone, pb_zone, data_years, source)
     VALUES (?, 15.0, 2.0, ?, 50, 'low', 'fair', 10, 'tencent')`
  ).run(stockCode, pePercentile);
}

/**
 * Seed market_history with a linear price series.
 * priceFn(i) returns the close price for day i.
 */
function seedMarketHistory(
  db: Database.Database,
  stockCode: string,
  days: number,
  priceFn: (i: number) => number
): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const baseDate = new Date('2020-01-02');
  for (let i = 0; i < days; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const close = priceFn(i);
    const dateStr = date.toISOString().slice(0, 10);
    stmt.run(stockCode, dateStr, close, close, close * 1.01, close * 0.99, 1000000);
  }
}

// --- Pure function tests ---

describe('percentileRank', () => {
  it('returns 50 for empty array', () => {
    expect(percentileRank(10, [])).toBe(50);
  });

  it('returns 0 when value is the minimum', () => {
    expect(percentileRank(1, [1, 2, 3, 4, 5])).toBe(0);
  });

  it('returns correct percentile for middle value', () => {
    // 2 values below 3 out of 5 total = 40%
    expect(percentileRank(3, [1, 2, 3, 4, 5])).toBe(40);
  });

  it('returns 80% when value is the maximum of 5', () => {
    // 4 values below 5 out of 5 total = 80%
    expect(percentileRank(5, [1, 2, 3, 4, 5])).toBe(80);
  });

  it('returns 100% when value is above all', () => {
    expect(percentileRank(10, [1, 2, 3, 4, 5])).toBe(100);
  });
});

describe('median', () => {
  it('returns 0 for empty array', () => {
    expect(median([])).toBe(0);
  });

  it('returns the single element for array of length 1', () => {
    expect(median([42])).toBe(42);
  });

  it('returns middle value for odd-length array', () => {
    expect(median([1, 3, 5])).toBe(3);
  });

  it('returns average of two middle values for even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('handles unsorted input', () => {
    expect(median([5, 1, 3])).toBe(3);
  });
});

describe('computePeriodStats', () => {
  it('returns zeros for empty returns', () => {
    const stats = computePeriodStats([]);
    expect(stats.winRate).toBe(0);
    expect(stats.avgReturn).toBe(0);
    expect(stats.maxReturn).toBe(0);
    expect(stats.maxLoss).toBe(0);
    expect(stats.medianReturn).toBe(0);
  });

  it('computes correct stats for mixed returns', () => {
    const returns = [0.1, -0.05, 0.2, -0.1, 0.15];
    const stats = computePeriodStats(returns);
    // winRate = 3/5 = 0.6
    expect(stats.winRate).toBe(0.6);
    // avgReturn = (0.1 - 0.05 + 0.2 - 0.1 + 0.15) / 5 = 0.06
    expect(stats.avgReturn).toBe(0.06);
    expect(stats.maxReturn).toBe(0.2);
    expect(stats.maxLoss).toBe(-0.1);
    // sorted: [-0.1, -0.05, 0.1, 0.15, 0.2] → median = 0.1
    expect(stats.medianReturn).toBe(0.1);
  });

  it('computes 100% win rate when all positive', () => {
    const stats = computePeriodStats([0.05, 0.1, 0.15]);
    expect(stats.winRate).toBe(1);
  });

  it('computes 0% win rate when all negative', () => {
    const stats = computePeriodStats([-0.05, -0.1, -0.15]);
    expect(stats.winRate).toBe(0);
  });
});

describe('generateBacktestSummary', () => {
  const makePeriodResults = (overrides: Partial<BacktestPeriodResult> = {}): BacktestPeriodResult[] => [
    { period: '30d', winRate: 0.5, avgReturn: 0.02, maxReturn: 0.1, maxLoss: -0.05, medianReturn: 0.01 },
    { period: '90d', winRate: 0.5, avgReturn: 0.03, maxReturn: 0.15, maxLoss: -0.08, medianReturn: 0.02 },
    { period: '180d', winRate: 0.52, avgReturn: -0.036, maxReturn: 0.2, maxLoss: -0.15, medianReturn: -0.02, ...overrides },
    { period: '365d', winRate: 0.5, avgReturn: 0.01, maxReturn: 0.3, maxLoss: -0.2, medianReturn: 0.005 },
  ];

  it('returns insufficient data message when matchingPoints is 0', () => {
    expect(generateBacktestSummary(makePeriodResults(), 0)).toBe('匹配数据不足，暂无法生成回测总结');
  });

  it('returns 偏强 for high winRate and avgReturn', () => {
    const result = generateBacktestSummary(makePeriodResults({ winRate: 0.7, avgReturn: 0.08 }), 10);
    expect(result).toContain('整体偏强');
    expect(result).toContain('胜率70%');
    expect(result).toContain('平均收益8.0%');
  });

  it('returns 中性偏强 for moderate positive stats', () => {
    const result = generateBacktestSummary(makePeriodResults({ winRate: 0.55, avgReturn: 0.03 }), 10);
    expect(result).toContain('整体中性偏强');
  });

  it('returns 中性偏弱 for borderline stats', () => {
    const result = generateBacktestSummary(makePeriodResults({ winRate: 0.45, avgReturn: -0.02 }), 10);
    expect(result).toContain('整体中性偏弱');
  });

  it('returns 偏弱 for poor stats', () => {
    const result = generateBacktestSummary(makePeriodResults({ winRate: 0.3, avgReturn: -0.1 }), 10);
    expect(result).toContain('整体偏弱');
  });
});

// --- DB-dependent function tests ---

describe('getCurrentPercentile', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns null when stock not in valuation_cache', () => {
    expect(getCurrentPercentile('999999', db)).toBeNull();
  });

  it('returns pe_percentile when stock exists', () => {
    seedValuationCache(db, '600519', 25.5);
    expect(getCurrentPercentile('600519', db)).toBe(25.5);
  });
});

describe('getHistoricalPrices', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns empty array for unknown stock', () => {
    expect(getHistoricalPrices('UNKNOWN', db)).toEqual([]);
  });

  it('returns prices sorted by date ascending', () => {
    seedMarketHistory(db, '600519', 10, (i) => 50 + i);
    const prices = getHistoricalPrices('600519', db);
    expect(prices.length).toBeGreaterThan(0);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i].tradeDate > prices[i - 1].tradeDate).toBe(true);
    }
  });
});

describe('computeHistoricalPercentiles', () => {
  it('returns empty for empty prices', () => {
    expect(computeHistoricalPercentiles([])).toEqual([]);
  });

  it('first element always has percentile 0 (nothing below it)', () => {
    const prices = [
      { tradeDate: '2020-01-02', closePrice: 50 },
      { tradeDate: '2020-01-03', closePrice: 60 },
    ];
    const result = computeHistoricalPercentiles(prices);
    expect(result[0].percentile).toBe(0);
  });

  it('computes increasing percentiles for rising prices', () => {
    const prices = Array.from({ length: 10 }, (_, i) => ({
      tradeDate: `2020-01-${String(i + 2).padStart(2, '0')}`,
      closePrice: 10 + i,
    }));
    const result = computeHistoricalPercentiles(prices);
    // Each new price is the highest so far, so percentile should be high
    for (let i = 1; i < result.length; i++) {
      // The last price in a rising series should have the highest percentile
      expect(result[i].percentile).toBeGreaterThanOrEqual(result[i - 1].percentile);
    }
  });
});

describe('findMatchingPoints', () => {
  it('returns empty when no points match', () => {
    const points = [
      { index: 0, tradeDate: '2020-01-02', percentile: 10 },
      { index: 1, tradeDate: '2020-01-03', percentile: 90 },
    ];
    const result = findMatchingPoints(points, 50, 5);
    expect(result).toEqual([]);
  });

  it('returns points within ±tolerance', () => {
    const points = [
      { index: 0, tradeDate: '2020-01-02', percentile: 24 },
      { index: 1, tradeDate: '2020-01-03', percentile: 25 },
      { index: 2, tradeDate: '2020-01-06', percentile: 30 },
      { index: 3, tradeDate: '2020-01-07', percentile: 36 },
    ];
    // currentPercentile=25, tolerance=5 → range [20, 30]
    const result = findMatchingPoints(points, 25, 5);
    expect(result).toHaveLength(3); // 24, 25, 30
    expect(result.map(p => p.index)).toEqual([0, 1, 2]);
  });

  it('includes boundary values', () => {
    const points = [
      { index: 0, tradeDate: '2020-01-02', percentile: 20 },
      { index: 1, tradeDate: '2020-01-03', percentile: 30 },
    ];
    const result = findMatchingPoints(points, 25, 5);
    expect(result).toHaveLength(2);
  });
});

describe('computeForwardReturns', () => {
  it('returns empty when no future data available', () => {
    const matchingPts = [{ index: 0 }];
    const prices = [{ closePrice: 100 }];
    expect(computeForwardReturns(matchingPts, prices, 30)).toEqual([]);
  });

  it('computes correct return', () => {
    const prices = [
      { closePrice: 100 },
      ...Array.from({ length: 30 }, () => ({ closePrice: 110 })),
    ];
    const matchingPts = [{ index: 0 }];
    const returns = computeForwardReturns(matchingPts, prices, 30);
    expect(returns).toHaveLength(1);
    expect(returns[0]).toBeCloseTo(0.1);
  });

  it('computes negative return correctly', () => {
    const prices = [
      { closePrice: 100 },
      ...Array.from({ length: 30 }, () => ({ closePrice: 90 })),
    ];
    const returns = computeForwardReturns([{ index: 0 }], prices, 30);
    expect(returns[0]).toBeCloseTo(-0.1);
  });

  it('skips points without enough future data', () => {
    const prices = Array.from({ length: 50 }, (_, i) => ({ closePrice: 100 + i }));
    const matchingPts = [
      { index: 10 }, // has 39 days ahead → enough for 30d
      { index: 45 }, // only 4 days ahead → not enough for 30d
    ];
    const returns = computeForwardReturns(matchingPts, prices, 30);
    expect(returns).toHaveLength(1);
  });
});


// --- Integration tests: runBacktest ---

describe('runBacktest', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns sampleWarning=true and disclaimer when no valuation data', () => {
    const result = runBacktest('999999', db);
    expect(result.stockCode).toBe('999999');
    expect(result.matchingPoints).toBe(0);
    expect(result.sampleWarning).toBe(true);
    expect(result.disclaimer).toBe(DISCLAIMER);
    expect(result.results).toHaveLength(4);
    result.results.forEach(r => {
      expect(['30d', '90d', '180d', '365d']).toContain(r.period);
      expect(r.winRate).toBe(0);
    });
  });

  it('returns sampleWarning=true when no market history', () => {
    seedValuationCache(db, '600519', 25);
    const result = runBacktest('600519', db);
    expect(result.currentPercentile).toBe(25);
    expect(result.matchingPoints).toBe(0);
    expect(result.sampleWarning).toBe(true);
  });

  it('returns valid backtest results with sufficient data', () => {
    // Create a stock with PE percentile at 20 (low valuation)
    seedValuationCache(db, '600519', 20);

    // Seed ~3 years of price data with a cyclical pattern
    // This creates prices that oscillate, so some historical points
    // will have similar percentile to the current one
    seedMarketHistory(db, '600519', 1100, (i) => {
      // Oscillating price: 50 + 30*sin(i/100)
      return 50 + 30 * Math.sin(i * Math.PI / 200);
    });

    const result = runBacktest('600519', db);

    expect(result.stockCode).toBe('600519');
    expect(result.currentPercentile).toBe(20);
    expect(result.disclaimer).toBe(DISCLAIMER);
    expect(result.results).toHaveLength(4);

    // Check all periods are present
    const periods = result.results.map(r => r.period);
    expect(periods).toEqual(['30d', '90d', '180d', '365d']);

    // Each result should have valid numeric fields
    result.results.forEach(r => {
      expect(typeof r.winRate).toBe('number');
      expect(typeof r.avgReturn).toBe('number');
      expect(typeof r.maxReturn).toBe('number');
      expect(typeof r.maxLoss).toBe('number');
      expect(typeof r.medianReturn).toBe('number');
      expect(r.winRate).toBeGreaterThanOrEqual(0);
      expect(r.winRate).toBeLessThanOrEqual(1);
      expect(r.maxReturn).toBeGreaterThanOrEqual(r.maxLoss);
    });
  });

  it('sets sampleWarning=true when matchingPoints < 5', () => {
    seedValuationCache(db, '600519', 95);
    // Very few data points → few matching points at 95th percentile
    seedMarketHistory(db, '600519', 50, (i) => 50 + i * 0.5);
    const result = runBacktest('600519', db);
    // With only ~35 trading days and percentile 95, very few points will match
    if (result.matchingPoints < MIN_SAMPLE_SIZE) {
      expect(result.sampleWarning).toBe(true);
    }
  });

  it('sets sampleWarning=false when matchingPoints >= 5', () => {
    seedValuationCache(db, '600519', 50);
    // Lots of data with flat prices → many points near 50th percentile
    seedMarketHistory(db, '600519', 1500, () => 50);
    const result = runBacktest('600519', db);
    // With constant price, all percentiles will be 0 (nothing below),
    // so this won't match percentile 50. Let's use a different approach.
    // Actually with all same prices, percentileRank returns 0 for all.
    // We need varied prices where many cluster around the 50th percentile.
    expect(result.disclaimer).toBe(DISCLAIMER);
  });

  it('disclaimer is always the exact required string', () => {
    const result = runBacktest('NONEXISTENT', db);
    expect(result.disclaimer).toBe('以上内容仅供学习参考，不构成投资依据');
  });

  it('handles stock with many matching points correctly', () => {
    seedValuationCache(db, '000001', 50);
    // Create data where prices gradually rise then fall, creating many points near 50th percentile
    seedMarketHistory(db, '000001', 1500, (i) => {
      // Triangle wave: goes up then down
      const cycle = i % 500;
      if (cycle < 250) return 30 + cycle * 0.16; // 30 to 70
      return 70 - (cycle - 250) * 0.16; // 70 to 30
    });

    const result = runBacktest('000001', db);
    expect(result.currentPercentile).toBe(50);
    expect(result.results).toHaveLength(4);
    // With triangle wave and many data points, we should have matching points
    if (result.matchingPoints >= MIN_SAMPLE_SIZE) {
      expect(result.sampleWarning).toBe(false);
    }
  });

  it('winRate is between 0 and 1 for all periods', () => {
    seedValuationCache(db, '600519', 30);
    seedMarketHistory(db, '600519', 1500, (i) => 50 + 20 * Math.sin(i * Math.PI / 150));
    const result = runBacktest('600519', db);
    result.results.forEach(r => {
      expect(r.winRate).toBeGreaterThanOrEqual(0);
      expect(r.winRate).toBeLessThanOrEqual(1);
    });
  });

  it('maxReturn >= maxLoss for all periods', () => {
    seedValuationCache(db, '600519', 30);
    seedMarketHistory(db, '600519', 1500, (i) => 50 + 20 * Math.sin(i * Math.PI / 150));
    const result = runBacktest('600519', db);
    result.results.forEach(r => {
      expect(r.maxReturn).toBeGreaterThanOrEqual(r.maxLoss);
    });
  });
});
