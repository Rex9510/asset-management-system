import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';

let testDb: Database.Database;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

// Mock AI provider factory
const mockAnalyze = jest.fn();
jest.mock('../ai/aiProviderFactory', () => ({
  getAIProvider: () => ({
    analyze: mockAnalyze,
    chat: jest.fn(),
    getModelName: () => 'mock-model',
  }),
}));

// Mock market data service
jest.mock('../market/marketDataService', () => ({
  getQuote: jest.fn(),
}));

// Mock news service
jest.mock('../news/newsService', () => ({
  getNews: jest.fn(),
}));

import { getQuote } from '../market/marketDataService';
import { getNews } from '../news/newsService';
import { buildAnalysisContext, triggerAnalysis, getAnalysisHistory } from './analysisService';
import { AnalysisResult } from '../ai/aiProvider';

const mockGetQuote = getQuote as jest.MockedFunction<typeof getQuote>;
const mockGetNews = getNews as jest.MockedFunction<typeof getNews>;

const MOCK_QUOTE = {
  stockCode: '600000',
  stockName: '浦发银行',
  price: 11.5,
  changePercent: 2.3,
  volume: 1000000,
  timestamp: new Date().toISOString(),
};

const MOCK_ANALYSIS_RESULT: AnalysisResult = {
  stage: 'rising',
  spaceEstimate: '上方空间约10%-15%',
  keySignals: ['MACD金叉', 'RSI处于中性区间'],
  actionRef: 'hold',
  batchPlan: [{ action: 'sell', shares: 50, targetPrice: 13.0, note: '到达目标价可考虑减仓' }],
  confidence: 72,
  reasoning: '基于技术指标和行情数据分析，当前处于上升趋势，参考方案为持有观望。',
  riskAlerts: ['量价背离风险'],
};

function setupTestDb() {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  initializeDatabase(testDb);

  // Create a test user
  testDb.prepare(
    "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"
  ).run('testuser', 'hash', new Date().toISOString());
}

function seedMarketHistory(stockCode: string) {
  const insert = testDb.prepare(
    'INSERT INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  // Insert 65 days of data for indicator calculation
  for (let i = 0; i < 65; i++) {
    const date = new Date(2024, 0, 1 + i);
    const dateStr = date.toISOString().split('T')[0];
    const price = 10 + Math.sin(i / 10) * 2;
    insert.run(stockCode, dateStr, price - 0.2, price, price + 0.3, price - 0.5, 100000 + i * 1000);
  }
}

describe('analysisService', () => {
  beforeEach(() => {
    setupTestDb();
    jest.clearAllMocks();
    mockGetQuote.mockResolvedValue(MOCK_QUOTE);
    mockGetNews.mockResolvedValue([]);
    mockAnalyze.mockResolvedValue(MOCK_ANALYSIS_RESULT);
  });

  afterEach(() => {
    testDb.close();
  });

  describe('buildAnalysisContext', () => {
    it('should build context with market data', async () => {
      const ctx = await buildAnalysisContext('600000', 1, testDb);

      expect(ctx.stockCode).toBe('600000');
      expect(ctx.stockName).toBe('浦发银行');
      expect(ctx.marketData.price).toBe(11.5);
      expect(ctx.marketData.changePercent).toBe(2.3);
    });

    it('should include technical indicators when history data exists', async () => {
      seedMarketHistory('600000');
      const ctx = await buildAnalysisContext('600000', 1, testDb);

      expect(ctx.technicalIndicators).toBeDefined();
      expect(ctx.technicalIndicators.ma).toBeDefined();
    });

    it('should include position data when user has position', async () => {
      const now = new Date().toISOString();
      testDb.prepare(
        'INSERT INTO positions (user_id, stock_code, stock_name, cost_price, shares, buy_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(1, '600000', '浦发银行', 10.0, 100, '2024-01-15', now, now);

      const ctx = await buildAnalysisContext('600000', 1, testDb);

      expect(ctx.positionData).toBeDefined();
      expect(ctx.positionData!.costPrice).toBe(10.0);
      expect(ctx.positionData!.shares).toBe(100);
      expect(ctx.positionData!.buyDate).toBe('2024-01-15');
    });

    it('should include news items when available', async () => {
      mockGetNews.mockResolvedValue([
        { title: '浦发银行发布年报', summary: '业绩增长', source: '东方财富', publishedAt: '2024-01-01', url: '' },
      ]);

      const ctx = await buildAnalysisContext('600000', 1, testDb);

      expect(ctx.newsItems).toHaveLength(1);
      expect(ctx.newsItems![0].title).toBe('浦发银行发布年报');
    });

    it('should handle news service failure gracefully', async () => {
      mockGetNews.mockRejectedValue(new Error('News service down'));

      const ctx = await buildAnalysisContext('600000', 1, testDb);

      expect(ctx.newsItems).toBeUndefined();
    });

    it('should handle missing position data gracefully', async () => {
      const ctx = await buildAnalysisContext('600000', 1, testDb);

      expect(ctx.positionData).toBeUndefined();
    });
  });

  describe('triggerAnalysis', () => {
    it('should call AI provider and save result to database', async () => {
      const result = await triggerAnalysis('600000', 1, 'manual', testDb);

      expect(mockAnalyze).toHaveBeenCalledTimes(1);
      expect(result.stockCode).toBe('600000');
      expect(result.stockName).toBe('浦发银行');
      expect(result.stage).toBe('rising');
      expect(result.actionRef).toBe('hold');
      expect(result.confidence).toBe(72);
      expect(result.reasoning).toContain('参考方案');
      expect(result.triggerType).toBe('manual');
      expect(result.keySignals).toEqual(['MACD金叉', 'RSI处于中性区间']);
      expect(result.batchPlan).toHaveLength(1);
    });

    it('should persist analysis to database', async () => {
      await triggerAnalysis('600000', 1, 'manual', testDb);

      const row = testDb.prepare('SELECT * FROM analyses WHERE stock_code = ?').get('600000');
      expect(row).toBeDefined();
    });

    it('should reject invalid stock code', async () => {
      await expect(triggerAnalysis('999999', 1, 'manual', testDb))
        .rejects.toThrow('股票代码无效');
    });

    it('should support different trigger types', async () => {
      const result = await triggerAnalysis('600000', 1, 'volatility', testDb);
      expect(result.triggerType).toBe('volatility');
    });

    it('should include data sources in saved analysis', async () => {
      const result = await triggerAnalysis('600000', 1, 'manual', testDb);
      expect(result.dataSources).toContain('market_data');
      expect(result.dataSources).toContain('technical_indicators');
    });

    it('should include news in data sources when news available', async () => {
      mockGetNews.mockResolvedValue([
        { title: 'Test news', summary: 'Summary', source: 'Source', publishedAt: '2024-01-01', url: '' },
      ]);

      const result = await triggerAnalysis('600000', 1, 'manual', testDb);
      expect(result.dataSources).toContain('news');
    });
  });

  describe('getAnalysisHistory', () => {
    it('should return empty array when no analyses exist', () => {
      const history = getAnalysisHistory('600000', 1, 10, testDb);
      expect(history).toEqual([]);
    });

    it('should return analyses in descending order', async () => {
      await triggerAnalysis('600000', 1, 'manual', testDb);
      await triggerAnalysis('600000', 1, 'scheduled', testDb);

      const history = getAnalysisHistory('600000', 1, 10, testDb);
      expect(history).toHaveLength(2);
      // Most recent first
      expect(new Date(history[0].createdAt).getTime())
        .toBeGreaterThanOrEqual(new Date(history[1].createdAt).getTime());
    });

    it('should respect limit parameter', async () => {
      await triggerAnalysis('600000', 1, 'manual', testDb);
      await triggerAnalysis('600000', 1, 'manual', testDb);
      await triggerAnalysis('600000', 1, 'manual', testDb);

      const history = getAnalysisHistory('600000', 1, 2, testDb);
      expect(history).toHaveLength(2);
    });

    it('should only return analyses for the specified user', async () => {
      // Create second user
      testDb.prepare(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"
      ).run('otheruser', 'hash', new Date().toISOString());

      await triggerAnalysis('600000', 1, 'manual', testDb);
      await triggerAnalysis('600000', 2, 'manual', testDb);

      const history1 = getAnalysisHistory('600000', 1, 10, testDb);
      const history2 = getAnalysisHistory('600000', 2, 10, testDb);

      expect(history1).toHaveLength(1);
      expect(history2).toHaveLength(1);
    });

    it('should reject invalid stock code', () => {
      expect(() => getAnalysisHistory('999999', 1, 10, testDb))
        .toThrow('股票代码无效');
    });
  });
});
