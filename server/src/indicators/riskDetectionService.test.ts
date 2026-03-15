import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  RiskAlert,
  detectVolumeDivergence,
  detectLateSessionAnomaly,
  detectFalseBreakout,
  detectRiskAlerts,
} from './riskDetectionService';
import { MarketHistoryRow } from './indicatorService';
import { AppError } from '../errors/AppError';

let testDb: Database.Database;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db);
  return db;
}

function makeRow(overrides: Partial<MarketHistoryRow> & { trade_date: string }): MarketHistoryRow {
  return {
    open_price: 10,
    close_price: 10,
    high_price: 10.5,
    low_price: 9.5,
    volume: 1000000,
    ...overrides,
  };
}

function insertRows(db: Database.Database, stockCode: string, rows: MarketHistoryRow[]): void {
  const stmt = db.prepare(
    `INSERT INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of rows) {
    stmt.run(stockCode, r.trade_date, r.open_price, r.close_price, r.high_price, r.low_price, r.volume);
  }
}

describe('riskDetectionService - detectVolumeDivergence', () => {
  it('should return null with insufficient data (<6 rows)', () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      makeRow({ trade_date: `2024-01-0${i + 1}` })
    );
    expect(detectVolumeDivergence(history)).toBeNull();
  });

  it('should return null when volume increases but price also rises >1%', () => {
    const prev5 = Array.from({ length: 5 }, (_, i) =>
      makeRow({ trade_date: `2024-01-0${i + 1}`, volume: 1000000 })
    );
    const latest = makeRow({
      trade_date: '2024-01-06',
      open_price: 10,
      close_price: 10.2, // +2% price change
      volume: 1200000, // +20% volume
    });
    expect(detectVolumeDivergence([...prev5, latest])).toBeNull();
  });

  it('should detect warning when volume up >10% but price change <1% and positive', () => {
    const prev5 = Array.from({ length: 5 }, (_, i) =>
      makeRow({ trade_date: `2024-01-0${i + 1}`, volume: 1000000 })
    );
    const latest = makeRow({
      trade_date: '2024-01-06',
      open_price: 10,
      close_price: 10.05, // +0.5% price change
      volume: 1200000, // +20% volume
    });
    const alert = detectVolumeDivergence([...prev5, latest]);
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe('volume_divergence');
    expect(alert!.level).toBe('warning');
  });

  it('should detect danger when volume up >10% but price drops', () => {
    const prev5 = Array.from({ length: 5 }, (_, i) =>
      makeRow({ trade_date: `2024-01-0${i + 1}`, volume: 1000000 })
    );
    const latest = makeRow({
      trade_date: '2024-01-06',
      open_price: 10,
      close_price: 9.8, // -2% price drop
      volume: 1200000, // +20% volume
    });
    const alert = detectVolumeDivergence([...prev5, latest]);
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe('volume_divergence');
    expect(alert!.level).toBe('danger');
  });

  it('should return null when volume does not increase >10%', () => {
    const prev5 = Array.from({ length: 5 }, (_, i) =>
      makeRow({ trade_date: `2024-01-0${i + 1}`, volume: 1000000 })
    );
    const latest = makeRow({
      trade_date: '2024-01-06',
      open_price: 10,
      close_price: 9.8,
      volume: 1050000, // only +5% volume
    });
    expect(detectVolumeDivergence([...prev5, latest])).toBeNull();
  });
});

describe('riskDetectionService - detectLateSessionAnomaly', () => {
  it('should return null with empty history', () => {
    expect(detectLateSessionAnomaly([])).toBeNull();
  });

  it('should return null when daily range is zero', () => {
    const row = makeRow({
      trade_date: '2024-01-01',
      open_price: 10,
      close_price: 10,
      high_price: 10,
      low_price: 10,
    });
    expect(detectLateSessionAnomaly([row])).toBeNull();
  });

  it('should detect late rally when close deviates significantly from midpoint', () => {
    // Open=10, High=10.5, Low=9.8, Close=10.5
    // midpoint = (10 + 10.5 + 9.8) / 3 = 10.1
    // dailyChange = 10.5 - 10 = 0.5
    // lateMove = 10.5 - 10.1 = 0.4
    // ratio = 0.4 / 0.5 = 0.8 > 0.5 ✓
    // dailyChange/open = 0.5/10 = 0.05 > 0.005 ✓
    const row = makeRow({
      trade_date: '2024-01-01',
      open_price: 10,
      close_price: 10.5,
      high_price: 10.5,
      low_price: 9.8,
    });
    const alert = detectLateSessionAnomaly([row]);
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe('late_session_anomaly');
    expect(alert!.label).toContain('拉升');
  });

  it('should detect late drop when close is well below midpoint', () => {
    // Open=10, High=10.2, Low=9.5, Close=9.5
    // midpoint = (10 + 10.2 + 9.5) / 3 = 9.9
    // dailyChange = 9.5 - 10 = -0.5
    // lateMove = 9.5 - 9.9 = -0.4
    // ratio = 0.4 / 0.5 = 0.8 > 0.5 ✓
    const row = makeRow({
      trade_date: '2024-01-01',
      open_price: 10,
      close_price: 9.5,
      high_price: 10.2,
      low_price: 9.5,
    });
    const alert = detectLateSessionAnomaly([row]);
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe('late_session_anomaly');
    expect(alert!.label).toContain('跳水');
  });

  it('should return null when daily change is negligible', () => {
    const row = makeRow({
      trade_date: '2024-01-01',
      open_price: 10,
      close_price: 10.001,
      high_price: 10.5,
      low_price: 9.5,
    });
    expect(detectLateSessionAnomaly([row])).toBeNull();
  });
});

describe('riskDetectionService - detectFalseBreakout', () => {
  it('should return null with insufficient data (<22 rows)', () => {
    const history = Array.from({ length: 20 }, (_, i) =>
      makeRow({ trade_date: `2024-01-${String(i + 1).padStart(2, '0')}` })
    );
    expect(detectFalseBreakout(history)).toBeNull();
  });

  it('should detect false breakout when prev day broke MA20 and current day fell back', () => {
    // Build 20 days of stable prices around 10, then a breakout day, then a fallback
    const stableRows = Array.from({ length: 20 }, (_, i) =>
      makeRow({
        trade_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        close_price: 10,
        open_price: 10,
        high_price: 10.2,
        low_price: 9.8,
      })
    );
    // Day 21: breakout above MA20 (MA20 = 10)
    const breakoutDay = makeRow({
      trade_date: '2024-01-21',
      open_price: 10.2,
      close_price: 10.5, // above MA20 of 10
      high_price: 10.6,
      low_price: 10.1,
    });
    // Day 22: falls back below MA20
    const fallbackDay = makeRow({
      trade_date: '2024-01-22',
      open_price: 10.3,
      close_price: 9.8, // below MA20 of ~10
      high_price: 10.4,
      low_price: 9.7,
    });

    const history = [...stableRows, breakoutDay, fallbackDay];
    const alert = detectFalseBreakout(history);
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe('false_breakout');
    expect(alert!.level).toBe('danger');
  });

  it('should return null when breakout holds (current day still above MA20)', () => {
    const stableRows = Array.from({ length: 20 }, (_, i) =>
      makeRow({
        trade_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        close_price: 10,
      })
    );
    const breakoutDay = makeRow({
      trade_date: '2024-01-21',
      close_price: 10.5,
    });
    const holdDay = makeRow({
      trade_date: '2024-01-22',
      close_price: 10.3, // still above MA20 of ~10
    });

    const history = [...stableRows, breakoutDay, holdDay];
    expect(detectFalseBreakout(history)).toBeNull();
  });

  it('should return null when prev day did not break above MA20', () => {
    const stableRows = Array.from({ length: 20 }, (_, i) =>
      makeRow({
        trade_date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        close_price: 10,
      })
    );
    const noBrk = makeRow({
      trade_date: '2024-01-21',
      close_price: 9.8, // below MA20
    });
    const currentDay = makeRow({
      trade_date: '2024-01-22',
      close_price: 9.5,
    });

    const history = [...stableRows, noBrk, currentDay];
    expect(detectFalseBreakout(history)).toBeNull();
  });
});

describe('riskDetectionService - detectRiskAlerts (integration)', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it('should throw for invalid stock code', () => {
    expect(() => detectRiskAlerts('999999', testDb)).toThrow(AppError);
  });

  it('should return empty array when no market history', () => {
    const alerts = detectRiskAlerts('600000', testDb);
    expect(alerts).toEqual([]);
  });

  it('should return alerts when suspicious patterns exist', () => {
    // Insert 22 days of stable data
    const stmt = testDb.prepare(
      `INSERT INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (let i = 0; i < 20; i++) {
      const date = `2024-01-${String(i + 1).padStart(2, '0')}`;
      stmt.run('600000', date, 10, 10, 10.2, 9.8, 1000000);
    }
    // Day 21: breakout with normal volume
    stmt.run('600000', '2024-01-21', 10.2, 10.5, 10.6, 10.1, 1000000);
    // Day 22: fallback with high volume and price drop (triggers volume_divergence + false_breakout)
    stmt.run('600000', '2024-01-22', 10.3, 9.8, 10.4, 9.7, 1500000);

    const alerts = detectRiskAlerts('600000', testDb);
    expect(alerts.length).toBeGreaterThan(0);

    const types = alerts.map(a => a.type);
    expect(types).toContain('false_breakout');
  });

  it('should return RiskAlert objects with correct structure', () => {
    const stmt = testDb.prepare(
      `INSERT INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    // 6 days: 5 normal + 1 with volume divergence
    for (let i = 0; i < 5; i++) {
      stmt.run('600000', `2024-01-0${i + 1}`, 10, 10, 10.2, 9.8, 1000000);
    }
    stmt.run('600000', '2024-01-06', 10, 9.8, 10.1, 9.7, 1200000); // volume up, price down

    const alerts = detectRiskAlerts('600000', testDb);
    for (const alert of alerts) {
      expect(alert).toHaveProperty('type');
      expect(alert).toHaveProperty('level');
      expect(alert).toHaveProperty('label');
      expect(alert).toHaveProperty('description');
      expect(['volume_divergence', 'late_session_anomaly', 'false_breakout']).toContain(alert.type);
      expect(['warning', 'danger']).toContain(alert.level);
      expect(typeof alert.label).toBe('string');
      expect(typeof alert.description).toBe('string');
    }
  });
});
