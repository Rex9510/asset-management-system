import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  generateDeepReport,
  generateDeepReportAsync,
  getDeepReport,
  getDeepReportHistory,
  parseDeepAnalysisResponse,
} from './deepAnalysisService';
import * as aiProviderFactory from '../ai/aiProviderFactory';
import * as analysisService from './analysisService';
import * as valuationService from '../valuation/valuationService';
import * as marketDataService from '../market/marketDataService';

jest.mock('../ai/aiProviderFactory');
jest.mock('./analysisService');
jest.mock('../valuation/valuationService');
jest.mock('../market/marketDataService');

const mockGetAIProvider = aiProviderFactory.getAIProvider as jest.MockedFunction<typeof aiProviderFactory.getAIProvider>;
const mockBuildContext = analysisService.buildAnalysisContext as jest.MockedFunction<typeof analysisService.buildAnalysisContext>;
const mockGetValuation = valuationService.getValuationFromDb as jest.MockedFunction<typeof valuationService.getValuationFromDb>;
const mockGetQuote = marketDataService.getQuote as jest.MockedFunction<typeof marketDataService.getQuote>;

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function addUser(db: Database.Database, id: number) {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, 'u' + id, 'h');
}

const MOCK_AI_RESPONSE = `=== 结论 ===
该股当前处于合理估值区间，短期震荡为主，参考方案为轻仓观望。

=== 基本面 ===
行业龙头地位稳固，竞争优势明显，成长性良好。

=== 财务数据 ===
营收稳步增长，净利润率保持在15%以上，现金流充裕。

=== 估值分位 ===
当前PE处于近10年45%分位，属于合理区间，PB处于35%分位。

=== 交易策略 ===
参考操作方案：当前价位可轻仓配置，参考仓位20%，价格区间10-12元。`;

const mockProvider = {
  analyze: jest.fn(),
  chat: jest.fn().mockResolvedValue(MOCK_AI_RESPONSE),
  getModelName: jest.fn().mockReturnValue('deepseek-chat'),
};

const mockContext: any = {
  stockCode: '600000',
  stockName: '浦发银行',
  marketData: { price: 10.5, changePercent: 1.2, volume: 100000 },
  technicalIndicators: {
    ma: { ma5: 10.3, ma10: 10.1, ma20: 9.8, ma60: 9.5 },
    macd: { dif: 0.15, dea: 0.1, histogram: 0.05 },
    kdj: { k: 65, d: 58, j: 79 },
    rsi: { rsi6: 55, rsi12: 52, rsi24: 50 },
  },
  newsItems: [
    { title: '浦发银行发布年报', summary: '...', source: 'sina', publishedAt: '2024-01-01' },
  ],
};

const mockValuation: any = {
  stockCode: '600000',
  peValue: 8.5,
  pbValue: 0.6,
  pePercentile: 25,
  pbPercentile: 15,
  peZone: 'low',
  pbZone: 'low',
  dataYears: 10,
  source: 'tencent',
  updatedAt: '2024-01-01',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAIProvider.mockReturnValue(mockProvider as any);
  mockBuildContext.mockResolvedValue(mockContext);
  mockGetValuation.mockReturnValue(mockValuation);
  mockGetQuote.mockResolvedValue({
    stockCode: '600000',
    stockName: '浦发银行',
    price: 10.5,
    changePercent: 1.2,
    volume: 100000,
    timestamp: new Date().toISOString(),
  });
});

describe('parseDeepAnalysisResponse', () => {
  it('should parse all sections from AI response', () => {
    const result = parseDeepAnalysisResponse(MOCK_AI_RESPONSE);
    expect(result.conclusion).toContain('参考方案');
    expect(result.fundamentals).toContain('行业龙头');
    expect(result.financials).toContain('营收');
    expect(result.valuation).toContain('PE');
    expect(result.strategy).toContain('参考操作方案');
  });

  it('should handle missing sections gracefully', () => {
    const partial = `=== 结论 ===
简短结论

=== 基本面 ===
基本面分析`;
    const result = parseDeepAnalysisResponse(partial);
    expect(result.conclusion).toBe('简短结论');
    expect(result.fundamentals).toBe('基本面分析');
    expect(result.financials).toBe('数据不足');
    expect(result.valuation).toBe('数据不足');
    expect(result.strategy).toBe('数据不足');
  });

  it('should handle empty response', () => {
    const result = parseDeepAnalysisResponse('');
    expect(result.conclusion).toBe('分析生成中');
    expect(result.fundamentals).toBe('数据不足');
  });
});

describe('generateDeepReport', () => {
  it('should return cached report within 24h without calling AI', async () => {
    const db = makeDb();
    addUser(db, 1);

    // Insert a completed report from 1 hour ago
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    db.prepare(
      `INSERT INTO deep_reports (user_id, stock_code, stock_name, conclusion, fundamentals, financials, valuation, strategy, ai_model, confidence, data_cutoff_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).run(1, '600000', '浦发银行', '缓存结论', '基本面', '财务', '估值', '策略', 'deepseek-chat', 75, '2024-01-01', oneHourAgo);

    const report = await generateDeepReport('600000', 1, db);

    expect(report.conclusion).toBe('缓存结论');
    expect(report.status).toBe('completed');
    // AI should NOT have been called
    expect(mockProvider.chat).not.toHaveBeenCalled();
  });

  it('should call AI and create new report on cache miss', async () => {
    const db = makeDb();
    addUser(db, 1);

    const report = await generateDeepReport('600000', 1, db);

    expect(report.status).toBe('completed');
    expect(report.stockCode).toBe('600000');
    expect(report.stockName).toBe('浦发银行');
    expect(report.aiModel).toBe('deepseek-chat');
    expect(report.conclusion).toContain('参考方案');
    expect(mockProvider.chat).toHaveBeenCalledTimes(1);
  });

  it('should create deep_report message on completion', async () => {
    const db = makeDb();
    addUser(db, 1);

    await generateDeepReport('600000', 1, db);

    const msgs = db.prepare("SELECT * FROM messages WHERE type = 'deep_report'").all() as any[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].stock_code).toBe('600000');
    expect(msgs[0].summary).toBe('深度分析报告已完成');
    const detail = JSON.parse(msgs[0].detail);
    expect(detail.reportId).toBeDefined();
    expect(detail.conclusion).toContain('参考方案');
  });

  it('should mark report as failed when AI call fails', async () => {
    const db = makeDb();
    addUser(db, 1);
    mockProvider.chat.mockRejectedValueOnce(new Error('AI service unavailable'));

    const report = await generateDeepReport('600000', 1, db);

    expect(report.status).toBe('failed');
  });

  it('should share cache across users (different userId, same stockCode)', async () => {
    const db = makeDb();
    addUser(db, 1);
    addUser(db, 2);

    // User 1 generates report
    await generateDeepReport('600000', 1, db);
    expect(mockProvider.chat).toHaveBeenCalledTimes(1);

    // User 2 should get cached report
    const report2 = await generateDeepReport('600000', 2, db);
    expect(report2.status).toBe('completed');
    // AI should NOT have been called again
    expect(mockProvider.chat).toHaveBeenCalledTimes(1);
  });

  it('should not use cache older than 24h', async () => {
    const db = makeDb();
    addUser(db, 1);

    // Insert a completed report from 25 hours ago
    const old = new Date(Date.now() - 25 * 3600000).toISOString();
    db.prepare(
      `INSERT INTO deep_reports (user_id, stock_code, stock_name, conclusion, fundamentals, financials, valuation, strategy, ai_model, confidence, data_cutoff_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).run(1, '600000', '浦发银行', '旧结论', '旧基本面', '旧财务', '旧估值', '旧策略', 'deepseek-chat', 75, '2024-01-01', old);

    const report = await generateDeepReport('600000', 1, db);

    // Should have called AI (cache expired)
    expect(mockProvider.chat).toHaveBeenCalledTimes(1);
    expect(report.conclusion).not.toBe('旧结论');
  });
});

describe('generateDeepReportAsync', () => {
  it('should return reportId and generating status immediately', async () => {
    const db = makeDb();
    addUser(db, 1);

    const result = await generateDeepReportAsync('600000', 1, db);

    expect(result.reportId).toBeGreaterThan(0);
    expect(result.status).toBe('generating');
  });

  it('should return cached reportId if cache exists', async () => {
    const db = makeDb();
    addUser(db, 1);

    // Insert cached report
    const recent = new Date(Date.now() - 3600000).toISOString();
    const ins = db.prepare(
      `INSERT INTO deep_reports (user_id, stock_code, stock_name, conclusion, fundamentals, financials, valuation, strategy, ai_model, confidence, data_cutoff_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).run(1, '600000', '浦发银行', '缓存', '基本面', '财务', '估值', '策略', 'deepseek-chat', 75, '2024-01-01', recent);

    const result = await generateDeepReportAsync('600000', 1, db);
    expect(result.reportId).toBe(Number(ins.lastInsertRowid));
  });
});

describe('getDeepReport', () => {
  it('should return report by ID', () => {
    const db = makeDb();
    addUser(db, 1);
    const now = new Date().toISOString();
    const ins = db.prepare(
      `INSERT INTO deep_reports (user_id, stock_code, stock_name, conclusion, fundamentals, financials, valuation, strategy, ai_model, confidence, data_cutoff_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).run(1, '600000', '浦发银行', '结论', '基本面', '财务', '估值', '策略', 'deepseek-chat', 80, '2024-01-01', now);

    const report = getDeepReport(Number(ins.lastInsertRowid), db);
    expect(report).not.toBeNull();
    expect(report!.stockCode).toBe('600000');
    expect(report!.conclusion).toBe('结论');
    expect(report!.confidence).toBe(80);
  });

  it('should return null for non-existent ID', () => {
    const db = makeDb();
    expect(getDeepReport(999, db)).toBeNull();
  });
});

describe('getDeepReportHistory', () => {
  function seedReports(db: Database.Database, count: number) {
    addUser(db, 1);
    const now = new Date();
    for (let i = 0; i < count; i++) {
      const createdAt = new Date(now.getTime() - i * 60000).toISOString();
      db.prepare(
        `INSERT INTO deep_reports (user_id, stock_code, stock_name, conclusion, fundamentals, financials, valuation, strategy, ai_model, confidence, data_cutoff_date, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
      ).run(1, i % 2 === 0 ? '600000' : '000001', i % 2 === 0 ? '浦发银行' : '平安银行', `结论${i}`, '基本面', '财务', '估值', '策略', 'deepseek-chat', 75, '2024-01-01', createdAt);
    }
  }

  it('should return paginated results', () => {
    const db = makeDb();
    seedReports(db, 10);

    const page1 = getDeepReportHistory(undefined, 1, 3, db);
    expect(page1.reports).toHaveLength(3);
    expect(page1.total).toBe(10);
    expect(page1.hasMore).toBe(true);

    const page4 = getDeepReportHistory(undefined, 4, 3, db);
    expect(page4.reports).toHaveLength(1);
    expect(page4.hasMore).toBe(false);
  });

  it('should filter by stockCode', () => {
    const db = makeDb();
    seedReports(db, 10);

    const result = getDeepReportHistory('600000', 1, 20, db);
    expect(result.total).toBe(5); // half are 600000
    expect(result.reports.every((r) => r.stockCode === '600000')).toBe(true);
  });

  it('should return empty for no results', () => {
    const db = makeDb();
    const result = getDeepReportHistory(undefined, 1, 20, db);
    expect(result.reports).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });
});
