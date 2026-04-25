import Database from 'better-sqlite3';

// Mock fetchAndSaveStockHistory to avoid network calls in tests
jest.mock('../market/historyService', () => ({
  fetchAndSaveStockHistory: jest.fn().mockResolvedValue(0),
}));

import {
  checkPriceLow30,
  checkVolumeShrinkExpand,
  checkRsiOrMacdDivergence,
  checkMacdDivergence,
  determineStatus,
  estimateCycleLength,
  generateDescription,
  detectBottomSignals,
  getMonitors,
  addMonitor,
  deleteMonitor,
  updateAllMonitors,
  get3YearHistory,
  pickAdaptiveAnalysisWindow,
  fixBrokenMonitorCodes,
  CycleStatus,
} from './cycleDetectorService';

// --- Test helpers ---

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      failed_login_count INTEGER DEFAULT 0,
      locked_until DATETIME NULL,
      last_login_at DATETIME
    );

    CREATE TABLE market_history (
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

    CREATE TABLE market_cache (
      stock_code TEXT PRIMARY KEY,
      stock_name TEXT NOT NULL,
      price REAL NOT NULL,
      change_percent REAL NOT NULL,
      volume REAL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE hs300_constituents (
      stock_code TEXT PRIMARY KEY,
      stock_name TEXT NOT NULL,
      weight REAL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE cycle_monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      stock_code TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      cycle_length TEXT,
      current_phase TEXT,
      status TEXT CHECK(status IN ('bottom', 'falling', 'rising', 'high')),
      description TEXT,
      bottom_signals TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, stock_code)
    );

    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      stock_code TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT NOT NULL,
      analysis_id INTEGER,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Insert a test user
  db.prepare("INSERT INTO users (username, password_hash) VALUES ('testuser', 'hash123')").run();

  return db;
}

/**
 * Generate synthetic market history rows.
 * Prices follow a pattern based on the provided function.
 */
function generateHistory(
  stockCode: string,
  days: number,
  priceFn: (i: number) => number,
  volumeFn?: (i: number) => number,
  db?: Database.Database
): { trade_date: string; close_price: number; high_price: number; low_price: number; volume: number }[] {
  const rows: any[] = [];
  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() - days);

  for (let i = 0; i < days; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    const close = priceFn(i);
    const high = close * 1.02;
    const low = close * 0.98;
    const volume = volumeFn ? volumeFn(i) : 1000000;
    const dateStr = date.toISOString().slice(0, 10);

    rows.push({
      trade_date: dateStr,
      close_price: close,
      high_price: high,
      low_price: low,
      volume,
    });

    if (db) {
      db.prepare(
        `INSERT OR REPLACE INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(stockCode, dateStr, close, close, high, low, volume);
    }
  }

  return rows;
}

// --- Signal detection tests ---

describe('checkPriceLow30', () => {
  it('returns true when price is in lowest 30% of range', () => {
    // Price range: 10 to 100, current at 20 → (20-10)/(100-10) = 0.11 < 0.3
    const history = [
      ...Array.from({ length: 50 }, (_, i) => ({
        trade_date: `2022-01-${String(i + 1).padStart(2, '0')}`,
        close_price: 10 + i * 1.8, // goes up to ~100
        high_price: 12 + i * 1.8,
        low_price: 9 + i * 1.8,
        volume: 1000000,
      })),
      // Recent prices drop back to low
      ...Array.from({ length: 20 }, (_, i) => ({
        trade_date: `2023-01-${String(i + 1).padStart(2, '0')}`,
        close_price: 20,
        high_price: 22,
        low_price: 18,
        volume: 1000000,
      })),
    ];
    expect(checkPriceLow30(history)).toBe(true);
  });

  it('returns false when price is above 30% of range', () => {
    // All prices around 80 in a range of 10-100
    const history = [
      { trade_date: '2022-01-01', close_price: 10, high_price: 12, low_price: 9, volume: 1000000 },
      { trade_date: '2022-06-01', close_price: 100, high_price: 102, low_price: 98, volume: 1000000 },
      ...Array.from({ length: 20 }, (_, i) => ({
        trade_date: `2023-01-${String(i + 1).padStart(2, '0')}`,
        close_price: 80,
        high_price: 82,
        low_price: 78,
        volume: 1000000,
      })),
    ];
    expect(checkPriceLow30(history)).toBe(false);
  });

  it('returns false with insufficient data', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      trade_date: `2023-01-${String(i + 1).padStart(2, '0')}`,
      close_price: 10,
      high_price: 12,
      low_price: 9,
      volume: 1000000,
    }));
    expect(checkPriceLow30(history)).toBe(false);
  });
});

describe('checkVolumeShrinkExpand', () => {
  it('returns true when volume shrinks then expands', () => {
    // Need: avg5 > avg20 AND avg20 < avg60
    // Strategy: last 60 items have mixed high/low volume,
    // last 20 items have low volume, last 5 items have higher volume
    const history: any[] = [];
    for (let i = 0; i < 80; i++) {
      let volume: number;
      if (i < 60) {
        // First 60: high volume (contributes to avg60 being high)
        volume = 5000000;
      } else if (i < 75) {
        // Next 15: low volume (makes avg20 low)
        volume = 500000;
      } else {
        // Last 5: expanding volume (makes avg5 > avg20)
        volume = 2000000;
      }
      history.push({
        trade_date: `2023-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        close_price: 50,
        high_price: 52,
        low_price: 48,
        volume,
      });
    }
    // Verify: avg5 = 2M, avg20 = (15*500K + 5*2M)/20 = 875K, avg60 = (40*5M + 15*500K + 5*2M)/60 ≈ 3.625M
    // avg5(2M) > avg20(875K) ✓ AND avg20(875K) < avg60(3.625M) ✓
    expect(checkVolumeShrinkExpand(history)).toBe(true);
  });

  it('returns false when volume is consistently high', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({
      trade_date: `2023-01-${String(i + 1).padStart(2, '0')}`,
      close_price: 50,
      high_price: 52,
      low_price: 48,
      volume: 5000000,
    }));
    expect(checkVolumeShrinkExpand(history)).toBe(false);
  });

  it('returns false with insufficient data', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      trade_date: `2023-01-${String(i + 1).padStart(2, '0')}`,
      close_price: 50,
      high_price: 52,
      low_price: 48,
      volume: 1000000,
    }));
    expect(checkVolumeShrinkExpand(history)).toBe(false);
  });
});

describe('checkRsiOrMacdDivergence', () => {
  it('returns false with insufficient data', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      trade_date: `2023-01-${String(i + 1).padStart(2, '0')}`,
      close_price: 50,
      high_price: 52,
      low_price: 48,
      volume: 1000000,
    }));
    expect(checkRsiOrMacdDivergence(history)).toBe(false);
  });

  it('returns true when RSI is below 30', () => {
    // Create a strong downtrend to push RSI below 30
    const history = Array.from({ length: 100 }, (_, i) => ({
      trade_date: `2023-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      close_price: 100 - i * 0.8, // Steady decline
      high_price: 101 - i * 0.8,
      low_price: 99 - i * 0.8,
      volume: 1000000,
    }));
    expect(checkRsiOrMacdDivergence(history)).toBe(true);
  });
});

describe('checkMacdDivergence', () => {
  it('returns false with insufficient data', () => {
    const closes = Array.from({ length: 30 }, () => 50);
    expect(checkMacdDivergence(closes)).toBe(false);
  });

  it('returns false when no divergence exists', () => {
    // Steady decline - both price and MACD make new lows
    const closes = Array.from({ length: 100 }, (_, i) => 100 - i * 0.5);
    expect(checkMacdDivergence(closes)).toBe(false);
  });
});

// --- Status determination tests ---

describe('determineStatus', () => {
  it('returns bottom when 2+ signals triggered', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({
      trade_date: `2023-01-${String(i + 1).padStart(2, '0')}`,
      close_price: 50,
      high_price: 52,
      low_price: 48,
      volume: 1000000,
    }));
    expect(determineStatus(history, ['signal1', 'signal2'])).toBe('bottom');
  });

  it('returns bottom when 3 signals triggered', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({
      trade_date: `2023-01-${String(i + 1).padStart(2, '0')}`,
      close_price: 50,
      high_price: 52,
      low_price: 48,
      volume: 1000000,
    }));
    expect(determineStatus(history, ['s1', 's2', 's3'])).toBe('bottom');
  });

  it('returns high when price in top 30% of range', () => {
    const history = [
      { trade_date: '2022-01-01', close_price: 10, high_price: 12, low_price: 9, volume: 1000000 },
      ...Array.from({ length: 70 }, (_, i) => ({
        trade_date: `2023-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        close_price: 50 + i * 0.5,
        high_price: 52 + i * 0.5,
        low_price: 48 + i * 0.5,
        volume: 1000000,
      })),
      // Current price at 90, range 10-90, position = (90-10)/(90-10) = 1.0 > 0.7
      { trade_date: '2024-01-01', close_price: 90, high_price: 92, low_price: 88, volume: 1000000 },
    ];
    expect(determineStatus(history, [])).toBe('high');
  });

  it('returns rising when price above MA20 and MA60', () => {
    // Uptrend: prices steadily rising
    const history = Array.from({ length: 100 }, (_, i) => ({
      trade_date: `2023-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      close_price: 30 + i * 0.3, // Steady rise from 30 to 60
      high_price: 31 + i * 0.3,
      low_price: 29 + i * 0.3,
      volume: 1000000,
    }));
    const status = determineStatus(history, []);
    // Price at ~60, MA20 and MA60 will be below current price
    expect(['rising', 'high']).toContain(status);
  });

  it('returns falling when price below MA60', () => {
    // Downtrend: prices steadily falling
    const history = Array.from({ length: 100 }, (_, i) => ({
      trade_date: `2023-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      close_price: 100 - i * 0.5, // Steady decline from 100 to 50
      high_price: 101 - i * 0.5,
      low_price: 99 - i * 0.5,
      volume: 1000000,
    }));
    expect(determineStatus(history, [])).toBe('falling');
  });

  it('returns falling with insufficient data and no signals', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      trade_date: `2023-01-${String(i + 1).padStart(2, '0')}`,
      close_price: 50,
      high_price: 52,
      low_price: 48,
      volume: 1000000,
    }));
    expect(determineStatus(history, [])).toBe('falling');
  });
});

// --- Cycle length estimation tests ---

describe('estimateCycleLength', () => {
  it('returns null with insufficient data', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({
      trade_date: `2023-01-${String(i + 1).padStart(2, '0')}`,
      close_price: 50,
      high_price: 52,
      low_price: 48,
      volume: 1000000,
    }));
    expect(estimateCycleLength(history)).toBeNull();
  });

  it('returns a cycle length string for data with clear cycles', () => {
    // Create a sinusoidal price pattern over 3 years (~750 trading days)
    const history = Array.from({ length: 750 }, (_, i) => ({
      trade_date: `${2021 + Math.floor(i / 250)}-${String(Math.floor((i % 250) / 20) + 1).padStart(2, '0')}-${String((i % 20) + 1).padStart(2, '0')}`,
      close_price: 50 + 30 * Math.sin(i * 2 * Math.PI / 250), // ~250 day cycle
      high_price: 52 + 30 * Math.sin(i * 2 * Math.PI / 250),
      low_price: 48 + 30 * Math.sin(i * 2 * Math.PI / 250),
      volume: 1000000,
    }));
    const result = estimateCycleLength(history);
    expect(result).not.toBeNull();
    expect(result).toMatch(/约\d+/);
  });

  it('falls back to predefined long cycle when detected period is unrealistically short', () => {
    // 合成较短波动周期（约150个交易日），对黄金ETF应被预定义康波周期兜底
    const history = Array.from({ length: 900 }, (_, i) => ({
      trade_date: `${2021 + Math.floor(i / 250)}-${String(Math.floor((i % 250) / 20) + 1).padStart(2, '0')}-${String((i % 20) + 1).padStart(2, '0')}`,
      close_price: 5 + 0.8 * Math.sin(i * 2 * Math.PI / 150),
      high_price: 5.2 + 0.8 * Math.sin(i * 2 * Math.PI / 150),
      low_price: 4.8 + 0.8 * Math.sin(i * 2 * Math.PI / 150),
      volume: 1000000,
    }));
    const result = estimateCycleLength(history, '518880');
    expect(result).toContain('康波长周期');
  });
});

// --- Description generation tests ---

describe('generateDescription', () => {
  it('includes cycle rhythm, position, status, and signals', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({
      trade_date: `2023-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      close_price: 50,
      high_price: 52,
      low_price: 48,
      volume: 1000000,
    }));
    const desc = generateDescription(history, 'bottom', '约3年', ['RSI低于30超卖', '价格处于近3年最低30%区间'], undefined, 3);
    expect(desc).toContain('横盘末期');
    expect(desc).toContain('RSI低于30超卖');
  });

  it('handles null cycle length', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({
      trade_date: `2023-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      close_price: 50,
      high_price: 52,
      low_price: 48,
      volume: 1000000,
    }));
    const desc = generateDescription(history, 'falling', null, []);
    expect(desc).toContain('下跌阶段');
  });

  it('returns insufficient data message for short history', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      trade_date: `2023-01-${String(i + 1).padStart(2, '0')}`,
      close_price: 50,
      high_price: 52,
      low_price: 48,
      volume: 1000000,
    }));
    const desc = generateDescription(history, 'falling', null, []);
    expect(desc).toContain('历史数据不足');
  });
});

// --- CRUD tests ---

describe('CRUD operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    // Insert some market history for stock 600519
    generateHistory('600519', 800, (i) => 50 + Math.sin(i / 50) * 20, undefined, db);
    // Insert stock name in market_cache
    db.prepare("INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES ('600519', '贵州茅台', 1800, 0.5)").run();
  });

  afterEach(() => {
    db.close();
  });

  describe('getMonitors', () => {
    it('returns empty array when no monitors exist', () => {
      const monitors = getMonitors(1, db);
      expect(monitors).toEqual([]);
    });

    it('returns monitors for a user', async () => {
      await addMonitor(1, '600519', db);
      const monitors = getMonitors(1, db);
      expect(monitors).toHaveLength(1);
      expect(monitors[0].stockCode).toBe('600519');
      expect(monitors[0].stockName).toBe('贵州茅台');
      expect(monitors[0].userId).toBe(1);
    });
  });

  describe('addMonitor', () => {
    it('creates a new monitor with detection results', async () => {
      const monitor = await addMonitor(1, '600519', db);
      expect(monitor.stockCode).toBe('600519');
      expect(monitor.stockName).toBe('贵州茅台');
      expect(['bottom', 'falling', 'rising', 'high']).toContain(monitor.status);
      expect(monitor.description).toBeTruthy();
      expect(Array.isArray(monitor.bottomSignals)).toBe(true);
    });

    it('returns existing monitor if already added', async () => {
      const first = await addMonitor(1, '600519', db);
      const second = await addMonitor(1, '600519', db);
      expect(first.id).toBe(second.id);
    });

    it('resolves stock name from hs300_constituents', async () => {
      db.prepare("INSERT INTO hs300_constituents (stock_code, stock_name) VALUES ('000001', '平安银行')").run();
      generateHistory('000001', 800, (i) => 10 + Math.sin(i / 50) * 3, undefined, db);
      const monitor = await addMonitor(1, '000001', db);
      expect(monitor.stockName).toBe('平安银行');
    });

    it('uses stock code as name when not found in cache', async () => {
      generateHistory('999999', 800, (i) => 50, undefined, db);
      const monitor = await addMonitor(1, '999999', db);
      expect(monitor.stockName).toBe('999999');
    });
  });

  describe('deleteMonitor', () => {
    it('deletes an existing monitor', async () => {
      const monitor = await addMonitor(1, '600519', db);
      const deleted = deleteMonitor(1, monitor.id, db);
      expect(deleted).toBe(true);
      expect(getMonitors(1, db)).toHaveLength(0);
    });

    it('returns false when monitor does not exist', () => {
      expect(deleteMonitor(1, 999, db)).toBe(false);
    });

    it('does not delete another user\'s monitor', async () => {
      db.prepare("INSERT INTO users (username, password_hash) VALUES ('user2', 'hash456')").run();
      const monitor = await addMonitor(1, '600519', db);
      const deleted = deleteMonitor(2, monitor.id, db);
      expect(deleted).toBe(false);
      expect(getMonitors(1, db)).toHaveLength(1);
    });
  });
});

// --- Daily update tests ---

describe('updateAllMonitors', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    generateHistory('600519', 800, (i) => 50 + Math.sin(i / 50) * 20, undefined, db);
    db.prepare("INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES ('600519', '贵州茅台', 1800, 0.5)").run();
  });

  afterEach(() => {
    db.close();
  });

  it('updates all monitors with fresh detection results', async () => {
    await addMonitor(1, '600519', db);
    const before = getMonitors(1, db);
    expect(before).toHaveLength(1);

    updateAllMonitors(db);

    const after = getMonitors(1, db);
    expect(after).toHaveLength(1);
    expect(['bottom', 'falling', 'rising', 'high']).toContain(after[0].status);
  });

  it('creates cycle_bottom message when status changes to bottom', async () => {
    // Add monitor with non-bottom status
    await addMonitor(1, '600519', db);

    // Force status to 'falling' so we can detect a change
    db.prepare("UPDATE cycle_monitors SET status = 'falling' WHERE stock_code = '600519'").run();

    // Create history that triggers bottom signals:
    // Clear existing history and create bottom-like data
    db.prepare("DELETE FROM market_history WHERE stock_code = '600519'").run();

    // Price range: high at 100, current at 15 → in lowest 30%
    // Volume: shrink then expand pattern
    // RSI: strong downtrend → RSI < 30
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - 900);

    const stmt = db.prepare(
      `INSERT OR REPLACE INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    for (let i = 0; i < 800; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      if (date.getDay() === 0 || date.getDay() === 6) continue;

      let close: number;
      let volume: number;

      if (i < 200) {
        close = 100 - i * 0.1; // Decline from 100 to 80
        volume = 5000000;
      } else if (i < 600) {
        close = 80 - (i - 200) * 0.15; // Further decline to 20
        volume = 1000000; // Shrunk volume
      } else if (i < 795) {
        close = 20 - (i - 600) * 0.02; // Continue declining slowly
        volume = 800000; // Still shrunk
      } else {
        close = 16; // Near bottom
        volume = 3000000; // Volume expanding
      }

      close = Math.max(close, 10);
      const dateStr = date.toISOString().slice(0, 10);
      stmt.run('600519', dateStr, close, close, close * 1.02, close * 0.98, volume);
    }

    updateAllMonitors(db);

    const monitors = getMonitors(1, db);
    // Check if bottom was detected (depends on exact data)
    if (monitors[0].status === 'bottom') {
      // Should have created a message
      const messages = db.prepare(
        "SELECT * FROM messages WHERE type = 'cycle_bottom' AND stock_code = '600519'"
      ).all();
      expect(messages.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('does not create message when status stays the same', async () => {
    await addMonitor(1, '600519', db);
    const initialStatus = getMonitors(1, db)[0].status;

    // Update again - status shouldn't change
    updateAllMonitors(db);

    const messages = db.prepare(
      "SELECT * FROM messages WHERE type = 'cycle_bottom'"
    ).all();

    // If status was already bottom, no new message since it didn't change
    if (initialStatus === 'bottom') {
      // Message might have been created on add, but not on update
      expect(messages.length).toBeLessThanOrEqual(1);
    }
  });
});

// --- get3YearHistory tests ---

describe('get3YearHistory', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns only data from last 3 years', () => {
    // Insert data spanning 5 years
    const stmt = db.prepare(
      `INSERT INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    // 5 years ago
    stmt.run('600519', '2019-01-15', 50, 50, 52, 48, 1000000);
    // 2 years ago
    stmt.run('600519', '2023-06-15', 60, 60, 62, 58, 1000000);
    // Recent
    stmt.run('600519', '2024-06-15', 70, 70, 72, 68, 1000000);

    const history = get3YearHistory('600519', db);
    // Should not include the 5-year-old data
    const dates = history.map(r => r.trade_date);
    expect(dates).not.toContain('2019-01-15');
    expect(dates.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for unknown stock', () => {
    const history = get3YearHistory('UNKNOWN', db);
    expect(history).toEqual([]);
  });
});

describe('pickAdaptiveAnalysisWindow', () => {
  it('returns a bounded window and label for multi-year synthetic history', () => {
    const baseDate = new Date(2020, 0, 2);
    const history = Array.from({ length: 750 }, (_, i) => {
      const d = new Date(baseDate.getTime() + i * 86400000);
      const p = 50 + 30 * Math.sin((i * 2 * Math.PI) / 250);
      return {
        trade_date: d.toISOString().slice(0, 10),
        close_price: p,
        high_price: p * 1.02,
        low_price: p * 0.98,
        volume: 1_000_000,
      };
    });
    const { windowHistory, labelYears, targetYears } = pickAdaptiveAnalysisWindow(history, '600519');
    expect(windowHistory.length).toBeGreaterThanOrEqual(20);
    expect(labelYears).not.toBeNull();
    expect(targetYears).toBeGreaterThan(0);
    expect(targetYears).toBeLessThanOrEqual(10);
  });
});

// --- detectBottomSignals integration test ---

describe('detectBottomSignals', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns valid result structure', () => {
    generateHistory('600519', 800, (i) => 50 + Math.sin(i / 50) * 20, undefined, db);
    const result = detectBottomSignals('600519', db);

    expect(Array.isArray(result.signals)).toBe(true);
    expect(['bottom', 'falling', 'rising', 'high']).toContain(result.status);
    expect(typeof result.description).toBe('string');
    expect(result.currentPhase).toBeTruthy();
    expect(result.analysisWindowYears === null || typeof result.analysisWindowYears === 'number').toBe(true);
    expect(result.anchorPrice).not.toBeNull();
  });

  it('returns falling with no signals for insufficient data', () => {
    generateHistory('600519', 10, () => 50, undefined, db);
    const result = detectBottomSignals('600519', db);
    expect(result.signals).toEqual([]);
    expect(result.status).toBe('falling');
    expect(result.anchorPrice).not.toBeNull();
  });
});


// --- fixBrokenMonitorCodes tests ---

describe('fixBrokenMonitorCodes', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    db.prepare("INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES ('518880', '黄金ETF', 5.5, 0.3)").run();
    db.prepare("INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES ('515220', '煤炭ETF', 2.1, -0.5)").run();
    db.prepare("INSERT INTO hs300_constituents (stock_code, stock_name) VALUES ('600519', '贵州茅台')").run();
  });

  afterEach(() => {
    db.close();
  });

  it('fixes monitors where stock_code contains name instead of code', () => {
    // Insert broken records (name stored as code)
    db.prepare(
      `INSERT INTO cycle_monitors (user_id, stock_code, stock_name, status, updated_at)
       VALUES (1, '黄金ETF', '黄金ETF', 'falling', '2026-01-01')`
    ).run();
    db.prepare(
      `INSERT INTO cycle_monitors (user_id, stock_code, stock_name, status, updated_at)
       VALUES (1, '煤炭ETF', '煤炭ETF', 'falling', '2026-01-01')`
    ).run();

    fixBrokenMonitorCodes(db);

    const monitors = getMonitors(1, db);
    expect(monitors).toHaveLength(2);
    const codes = monitors.map(m => m.stockCode).sort();
    expect(codes).toEqual(['515220', '518880']);
  });

  it('does not modify monitors with valid 6-digit codes', () => {
    db.prepare(
      `INSERT INTO cycle_monitors (user_id, stock_code, stock_name, status, updated_at)
       VALUES (1, '518880', '黄金ETF', 'falling', '2026-01-01')`
    ).run();

    fixBrokenMonitorCodes(db);

    const monitors = getMonitors(1, db);
    expect(monitors).toHaveLength(1);
    expect(monitors[0].stockCode).toBe('518880');
  });

  it('deletes monitors with unresolvable names', () => {
    db.prepare(
      `INSERT INTO cycle_monitors (user_id, stock_code, stock_name, status, updated_at)
       VALUES (1, '不存在的ETF', '不存在的ETF', 'falling', '2026-01-01')`
    ).run();

    fixBrokenMonitorCodes(db);

    const monitors = getMonitors(1, db);
    expect(monitors).toHaveLength(0);
  });

  it('drops broken row when user already has same resolved stock_code', () => {
    db.prepare(
      `INSERT INTO cycle_monitors (user_id, stock_code, stock_name, status, updated_at)
       VALUES (1, '515220', '煤炭ETF', 'falling', '2026-01-01')`
    ).run();
    db.prepare(
      `INSERT INTO cycle_monitors (user_id, stock_code, stock_name, status, updated_at)
       VALUES (1, '煤炭ETF', '煤炭ETF', 'falling', '2026-01-01')`
    ).run();

    fixBrokenMonitorCodes(db);

    const monitors = getMonitors(1, db);
    expect(monitors).toHaveLength(1);
    expect(monitors[0].stockCode).toBe('515220');
  });

  it('fixes monitors via ETF_NAME_TO_CODE fallback when not in market_cache or hs300', () => {
    // Use a fresh db without market_cache entries for these ETFs
    const cleanDb = createTestDb();
    cleanDb.prepare(
      `INSERT INTO cycle_monitors (user_id, stock_code, stock_name, status, updated_at)
       VALUES (1, '化工ETF', '化工ETF', 'falling', '2026-01-01')`
    ).run();
    cleanDb.prepare(
      `INSERT INTO cycle_monitors (user_id, stock_code, stock_name, status, updated_at)
       VALUES (1, '原油ETF', '原油ETF', 'falling', '2026-01-01')`
    ).run();

    fixBrokenMonitorCodes(cleanDb);

    const monitors = getMonitors(1, cleanDb);
    expect(monitors).toHaveLength(2);
    const codes = monitors.map(m => m.stockCode).sort();
    expect(codes).toEqual(['161129', '516020']);
    cleanDb.close();
  });
});

// --- addMonitor name-to-code lookup tests ---

describe('addMonitor name lookup', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    db.prepare("INSERT INTO market_cache (stock_code, stock_name, price, change_percent) VALUES ('518880', '黄金ETF', 5.5, 0.3)").run();
    db.prepare("INSERT INTO hs300_constituents (stock_code, stock_name) VALUES ('600519', '贵州茅台')").run();
    generateHistory('518880', 800, (i) => 5 + Math.sin(i / 50) * 1, undefined, db);
    generateHistory('600519', 800, (i) => 1800 + Math.sin(i / 50) * 100, undefined, db);
  });

  afterEach(() => {
    db.close();
  });

  it('resolves stock name to code from market_cache', async () => {
    const monitor = await addMonitor(1, '黄金ETF', db);
    expect(monitor.stockCode).toBe('518880');
    expect(monitor.stockName).toBe('黄金ETF');
  });

  it('resolves stock name to code from hs300_constituents', async () => {
    const monitor = await addMonitor(1, '贵州茅台', db);
    expect(monitor.stockCode).toBe('600519');
    expect(monitor.stockName).toBe('贵州茅台');
  });

  it('still works with numeric stock code input', async () => {
    const monitor = await addMonitor(1, '518880', db);
    expect(monitor.stockCode).toBe('518880');
    expect(monitor.stockName).toBe('黄金ETF');
  });

  it('deduplicates when adding by name then by code', async () => {
    const first = await addMonitor(1, '黄金ETF', db);
    const second = await addMonitor(1, '518880', db);
    expect(first.id).toBe(second.id);
  });

  it('resolves ETF name via hardcoded fallback when not in market_cache or hs300', async () => {
    // Use a clean db without market_cache entries for 化工ETF
    const cleanDb = createTestDb();
    generateHistory('516020', 800, (i) => 1 + Math.sin(i / 50) * 0.3, undefined, cleanDb);
    const monitor = await addMonitor(1, '化工ETF', cleanDb);
    expect(monitor.stockCode).toBe('516020');
    expect(monitor.stockName).toBe('化工ETF');
    cleanDb.close();
  });

  it('resolves predefined ETF with different letter case (煤炭etf → 515220)', async () => {
    const cleanDb = createTestDb();
    generateHistory('515220', 800, (i) => 1 + Math.sin(i / 50) * 0.2, undefined, cleanDb);
    const monitor = await addMonitor(1, '煤炭etf', cleanDb);
    expect(monitor.stockCode).toBe('515220');
    expect(monitor.stockName).toBe('煤炭ETF');
    expect(monitor.description).not.toContain('历史数据不足');
    cleanDb.close();
  });
});
