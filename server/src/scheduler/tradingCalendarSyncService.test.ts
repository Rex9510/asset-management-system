import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import { syncTradingCalendarFromMarket } from './tradingCalendarSyncService';
import * as historyService from '../market/historyService';

let testDb: Database.Database;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

jest.mock('../market/historyService', () => ({
  fetchKlineMultiSegment: jest.fn(),
}));

const mockKline = historyService.fetchKlineMultiSegment as jest.MockedFunction<
  typeof historyService.fetchKlineMultiSegment
>;

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = OFF');
  initializeDatabase(testDb);
  jest.clearAllMocks();
});

afterEach(() => {
  testDb.close();
});

describe('syncTradingCalendarFromMarket', () => {
  it('writes trade dates from kline and replaces previous rows', async () => {
    mockKline.mockResolvedValueOnce([
      { tradeDate: '2025-06-03', open: 1, close: 1, high: 1, low: 1, volume: 1 },
      { tradeDate: '2025-06-04', open: 1, close: 1, high: 1, low: 1, volume: 1 },
    ]);
    await syncTradingCalendarFromMarket(testDb);
    const rows = testDb
      .prepare('SELECT trade_date FROM trading_calendar_sdk ORDER BY trade_date')
      .all() as { trade_date: string }[];
    expect(rows.map((r) => r.trade_date)).toEqual(['2025-06-03', '2025-06-04']);

    mockKline.mockResolvedValueOnce([
      { tradeDate: '2025-06-05', open: 1, close: 1, high: 1, low: 1, volume: 1 },
    ]);
    await syncTradingCalendarFromMarket(testDb);
    const rows2 = testDb
      .prepare('SELECT trade_date FROM trading_calendar_sdk ORDER BY trade_date')
      .all() as { trade_date: string }[];
    expect(rows2.map((r) => r.trade_date)).toEqual(['2025-06-05']);
  });
});
