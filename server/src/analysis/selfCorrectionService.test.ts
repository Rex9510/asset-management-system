import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import { checkAnalysisDeviation, runSelfCorrectionCheck } from './selfCorrectionService';
import * as analysisService from './analysisService';
import * as marketDataService from '../market/marketDataService';

jest.mock('./analysisService');
jest.mock('../market/marketDataService');

const mockTrigger = analysisService.triggerAnalysis as jest.MockedFunction<typeof analysisService.triggerAnalysis>;
const mockQuote = marketDataService.getQuote as jest.MockedFunction<typeof marketDataService.getQuote>;

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function addUser(db: Database.Database, id: number) {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, 'u' + id, 'h');
}

function addAnalysis(
  db: Database.Database,
  opts: {
    userId: number;
    stockCode: string;
    stockName: string;
    stage: string;
    actionRef: string;
    triggerType?: string;
    createdAt?: string;
    technicalIndicators?: string;
  }
) {
  const now = opts.createdAt || new Date().toISOString();
  db.prepare(
    `INSERT INTO analyses (user_id, stock_code, stock_name, trigger_type, stage, action_ref, confidence, reasoning, created_at, technical_indicators)
     VALUES (?, ?, ?, ?, ?, ?, 75, 'test reasoning', ?, ?)`
  ).run(
    opts.userId,
    opts.stockCode,
    opts.stockName,
    opts.triggerType || 'scheduled',
    opts.stage,
    opts.actionRef,
    now,
    opts.technicalIndicators || null
  );
}

const mockCorrectionResult: any = {
  id: 99,
  stockCode: '600000',
  stockName: '浦发银行',
  triggerType: 'self_correction',
  stage: 'falling',
  actionRef: 'reduce',
  confidence: 60,
  reasoning: '修正分析：实际走势偏离预期',
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTrigger.mockResolvedValue(mockCorrectionResult);
  mockQuote.mockResolvedValue({
    stockCode: '600000',
    stockName: '浦发银行',
    price: 9.0, // dropped from ~10
    changePercent: -5.5,
    volume: 100000,
    timestamp: new Date().toISOString(),
  });
});

describe('checkAnalysisDeviation', () => {
  it('should detect deviation when bullish prediction but price dropped >5%', async () => {
    const db = makeDb();
    addUser(db, 1);
    // Add analysis with bullish prediction and MA5 as price proxy
    addAnalysis(db, {
      userId: 1,
      stockCode: '600000',
      stockName: '浦发银行',
      stage: 'rising',
      actionRef: 'add',
      technicalIndicators: JSON.stringify({ ma: { ma5: 10.0 } }),
    });

    // Current price is 9.0 (10% drop from 10.0)
    mockQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 9.0,
      changePercent: -10,
      volume: 100000,
      timestamp: new Date().toISOString(),
    });

    const deviations = await checkAnalysisDeviation('600000', 1, db);
    expect(deviations).toHaveLength(1);
    expect(deviations[0].predictedStage).toBe('rising');
    expect(deviations[0].predictedAction).toBe('add');
    expect(deviations[0].deviationReason).toContain('看多预判存在明显偏差');
  });

  it('should detect deviation when bearish prediction but price rose >5%', async () => {
    const db = makeDb();
    addUser(db, 1);
    addAnalysis(db, {
      userId: 1,
      stockCode: '600000',
      stockName: '浦发银行',
      stage: 'falling',
      actionRef: 'reduce',
      technicalIndicators: JSON.stringify({ ma: { ma5: 10.0 } }),
    });

    mockQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 11.0, // 10% rise
      changePercent: 10,
      volume: 100000,
      timestamp: new Date().toISOString(),
    });

    const deviations = await checkAnalysisDeviation('600000', 1, db);
    expect(deviations).toHaveLength(1);
    expect(deviations[0].deviationReason).toContain('看空预判存在明显偏差');
  });

  it('should not detect deviation when prediction aligns with actual movement', async () => {
    const db = makeDb();
    addUser(db, 1);
    addAnalysis(db, {
      userId: 1,
      stockCode: '600000',
      stockName: '浦发银行',
      stage: 'rising',
      actionRef: 'hold',
      technicalIndicators: JSON.stringify({ ma: { ma5: 10.0 } }),
    });

    // Price rose slightly - aligns with bullish prediction
    mockQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 10.5,
      changePercent: 5,
      volume: 100000,
      timestamp: new Date().toISOString(),
    });

    const deviations = await checkAnalysisDeviation('600000', 1, db);
    expect(deviations).toHaveLength(0);
  });

  it('should generate self-correction analysis and message on deviation', async () => {
    const db = makeDb();
    addUser(db, 1);
    addAnalysis(db, {
      userId: 1,
      stockCode: '600000',
      stockName: '浦发银行',
      stage: 'rising',
      actionRef: 'add',
      technicalIndicators: JSON.stringify({ ma: { ma5: 10.0 } }),
    });

    mockQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 9.0,
      changePercent: -10,
      volume: 100000,
      timestamp: new Date().toISOString(),
    });

    await checkAnalysisDeviation('600000', 1, db);

    // Should have called triggerAnalysis with self_correction type
    expect(mockTrigger).toHaveBeenCalledWith('600000', 1, 'self_correction', db);

    // Should have stored a message
    const msgs = db.prepare("SELECT * FROM messages WHERE type = 'self_correction'").all() as any[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].stock_code).toBe('600000');
    expect(msgs[0].summary).toContain('自我修正');

    const detail = JSON.parse(msgs[0].detail);
    expect(detail.deviationReason).toBeDefined();
    expect(detail.correctedStage).toBe('falling');
    expect(detail.correctedAction).toBe('reduce');
  });

  it('should return empty array when no analyses exist', async () => {
    const db = makeDb();
    const deviations = await checkAnalysisDeviation('600000', 1, db);
    expect(deviations).toHaveLength(0);
  });

  it('should return empty array when quote fails', async () => {
    const db = makeDb();
    addUser(db, 1);
    addAnalysis(db, {
      userId: 1,
      stockCode: '600000',
      stockName: '浦发银行',
      stage: 'rising',
      actionRef: 'add',
      technicalIndicators: JSON.stringify({ ma: { ma5: 10.0 } }),
    });

    mockQuote.mockRejectedValue(new Error('no data'));
    const deviations = await checkAnalysisDeviation('600000', 1, db);
    expect(deviations).toHaveLength(0);
  });

  it('should skip old analyses beyond lookback window', async () => {
    const db = makeDb();
    addUser(db, 1);
    // Add analysis from 10 days ago
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    addAnalysis(db, {
      userId: 1,
      stockCode: '600000',
      stockName: '浦发银行',
      stage: 'rising',
      actionRef: 'add',
      createdAt: oldDate.toISOString(),
      technicalIndicators: JSON.stringify({ ma: { ma5: 10.0 } }),
    });

    const deviations = await checkAnalysisDeviation('600000', 1, db);
    expect(deviations).toHaveLength(0);
  });

  it('should skip self_correction type analyses', async () => {
    const db = makeDb();
    addUser(db, 1);
    addAnalysis(db, {
      userId: 1,
      stockCode: '600000',
      stockName: '浦发银行',
      stage: 'rising',
      actionRef: 'add',
      triggerType: 'self_correction',
      technicalIndicators: JSON.stringify({ ma: { ma5: 10.0 } }),
    });

    const deviations = await checkAnalysisDeviation('600000', 1, db);
    expect(deviations).toHaveLength(0);
  });

  it('should use market_history as fallback when no technical_indicators', async () => {
    const db = makeDb();
    addUser(db, 1);
    const today = new Date().toISOString().split('T')[0];
    // Add market history
    db.prepare(
      'INSERT INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume) VALUES (?, ?, 10, 10, 10.5, 9.5, 1000)'
    ).run('600000', today);

    addAnalysis(db, {
      userId: 1,
      stockCode: '600000',
      stockName: '浦发银行',
      stage: 'rising',
      actionRef: 'add',
      // No technical_indicators
    });

    mockQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 9.0, // 10% drop from close_price 10
      changePercent: -10,
      volume: 100000,
      timestamp: new Date().toISOString(),
    });

    const deviations = await checkAnalysisDeviation('600000', 1, db);
    expect(deviations).toHaveLength(1);
  });

  it('should mark severe deviation for >10% price change', async () => {
    const db = makeDb();
    addUser(db, 1);
    addAnalysis(db, {
      userId: 1,
      stockCode: '600000',
      stockName: '浦发银行',
      stage: 'rising',
      actionRef: 'add',
      technicalIndicators: JSON.stringify({ ma: { ma5: 10.0 } }),
    });

    mockQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 8.5, // 15% drop
      changePercent: -15,
      volume: 100000,
      timestamp: new Date().toISOString(),
    });

    const deviations = await checkAnalysisDeviation('600000', 1, db);
    expect(deviations).toHaveLength(1);
    expect(deviations[0].severity).toBe('severe');
  });
});

describe('runSelfCorrectionCheck', () => {
  it('should batch check all recent analyses', async () => {
    const db = makeDb();
    addUser(db, 1);
    addUser(db, 2);
    addAnalysis(db, {
      userId: 1,
      stockCode: '600000',
      stockName: '浦发银行',
      stage: 'rising',
      actionRef: 'add',
      technicalIndicators: JSON.stringify({ ma: { ma5: 10.0 } }),
    });
    addAnalysis(db, {
      userId: 2,
      stockCode: '000001',
      stockName: '平安银行',
      stage: 'rising',
      actionRef: 'add',
      technicalIndicators: JSON.stringify({ ma: { ma5: 10.0 } }),
    });

    // Both stocks dropped
    mockQuote.mockResolvedValue({
      stockCode: '600000',
      stockName: '浦发银行',
      price: 9.0,
      changePercent: -10,
      volume: 100000,
      timestamp: new Date().toISOString(),
    });

    const count = await runSelfCorrectionCheck(db);
    expect(count).toBe(2);
    expect(mockTrigger).toHaveBeenCalledTimes(2);
  });

  it('should return 0 when no recent analyses', async () => {
    const db = makeDb();
    const count = await runSelfCorrectionCheck(db);
    expect(count).toBe(0);
  });

  it('should continue on individual check failure', async () => {
    const db = makeDb();
    addUser(db, 1);
    addAnalysis(db, {
      userId: 1,
      stockCode: '600000',
      stockName: '浦发银行',
      stage: 'rising',
      actionRef: 'add',
      technicalIndicators: JSON.stringify({ ma: { ma5: 10.0 } }),
    });
    addAnalysis(db, {
      userId: 1,
      stockCode: '000001',
      stockName: '平安银行',
      stage: 'rising',
      actionRef: 'add',
      technicalIndicators: JSON.stringify({ ma: { ma5: 10.0 } }),
    });

    // First call fails, second succeeds
    mockQuote
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({
        stockCode: '000001',
        stockName: '平安银行',
        price: 9.0,
        changePercent: -10,
        volume: 100000,
        timestamp: new Date().toISOString(),
      });

    const count = await runSelfCorrectionCheck(db);
    expect(count).toBe(1);
  });
});
