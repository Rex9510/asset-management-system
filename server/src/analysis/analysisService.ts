import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { getAIProvider } from '../ai/aiProviderFactory';
import { AnalysisContext, AnalysisResult } from '../ai/aiProvider';
import { getQuote } from '../market/marketDataService';
import { getIndicators, getMarketHistory, IndicatorData, MarketHistoryRow } from '../indicators/indicatorService';
import { detectRiskAlerts, RiskAlert } from '../indicators/riskDetectionService';
import { getNews } from '../news/newsService';
import { crossValidateConfidence } from './confidenceService';
import { Errors } from '../errors/AppError';
import { isValidStockCode } from '../positions/positionService';

// --- Types ---

export interface AnalysisRow {
  id: number;
  user_id: number;
  stock_code: string;
  stock_name: string;
  trigger_type: string;
  stage: string;
  space_estimate: string | null;
  key_signals: string | null;
  action_ref: string;
  batch_plan: string | null;
  confidence: number;
  reasoning: string;
  data_sources: string | null;
  technical_indicators: string | null;
  news_summary: string | null;
  recovery_estimate: string | null;
  profit_estimate: string | null;
  risk_alerts: string | null;
  created_at: string;
}

export interface AnalysisResponse {
  id: number;
  userId: number;
  stockCode: string;
  stockName: string;
  triggerType: string;
  stage: string;
  spaceEstimate: string;
  keySignals: string[];
  actionRef: string;
  batchPlan: { action: string; shares: number; targetPrice: number; note: string }[];
  confidence: number;
  reasoning: string;
  dataSources: string[];
  technicalIndicators: Record<string, unknown> | null;
  newsSummary: string[];
  recoveryEstimate: string | null;
  profitEstimate: string | null;
  riskAlerts: string[];
  createdAt: string;
}

// --- Helper: safe JSON parse ---

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// --- Row to response ---

function toAnalysisResponse(row: AnalysisRow): AnalysisResponse {
  return {
    id: row.id,
    userId: row.user_id,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    triggerType: row.trigger_type,
    stage: row.stage,
    spaceEstimate: row.space_estimate || '',
    keySignals: safeJsonParse<string[]>(row.key_signals, []),
    actionRef: row.action_ref,
    batchPlan: safeJsonParse(row.batch_plan, []),
    confidence: row.confidence,
    reasoning: row.reasoning,
    dataSources: safeJsonParse<string[]>(row.data_sources, []),
    technicalIndicators: safeJsonParse<Record<string, unknown> | null>(row.technical_indicators, null),
    newsSummary: safeJsonParse<string[]>(row.news_summary, []),
    recoveryEstimate: row.recovery_estimate || null,
    profitEstimate: row.profit_estimate || null,
    riskAlerts: safeJsonParse<string[]>(row.risk_alerts, []),
    createdAt: row.created_at,
  };
}


// --- Build analysis context ---

export async function buildAnalysisContext(
  stockCode: string,
  userId: number,
  db?: Database.Database
): Promise<AnalysisContext> {
  const database = db || getDatabase();

  // 1. Get market quote
  const quote = await getQuote(stockCode, database);

  // 2. Get technical indicators (may throw if no history data)
  let technicalIndicators: AnalysisContext['technicalIndicators'] = {};
  try {
    const indicators = getIndicators(stockCode, database);
    technicalIndicators = {
      ma: indicators.ma.ma5 != null ? {
        ma5: indicators.ma.ma5!,
        ma10: indicators.ma.ma10!,
        ma20: indicators.ma.ma20!,
        ma60: indicators.ma.ma60!,
      } : undefined,
      macd: indicators.macd.dif != null ? {
        dif: indicators.macd.dif!,
        dea: indicators.macd.dea!,
        histogram: indicators.macd.histogram!,
      } : undefined,
      kdj: indicators.kdj.k != null ? {
        k: indicators.kdj.k!,
        d: indicators.kdj.d!,
        j: indicators.kdj.j!,
      } : undefined,
      rsi: indicators.rsi.rsi6 != null ? {
        rsi6: indicators.rsi.rsi6!,
        rsi12: indicators.rsi.rsi12!,
        rsi24: indicators.rsi.rsi24!,
      } : undefined,
    };
  } catch {
    // Technical indicators not available - continue without them
  }

  // 3. Get news (never throws, returns empty array on failure)
  let newsItems: AnalysisContext['newsItems'] = [];
  try {
    const news = await getNews(stockCode, 5, database);
    newsItems = news.map((n) => ({
      title: n.title,
      summary: n.summary,
      source: n.source,
      publishedAt: n.publishedAt,
    }));
  } catch {
    // News not available - continue without
  }

  // 4. Get position data for this user and stock
  let positionData: AnalysisContext['positionData'] | undefined;
  try {
    const posRow = database
      .prepare('SELECT cost_price, shares, buy_date FROM positions WHERE user_id = ? AND stock_code = ? LIMIT 1')
      .get(userId, stockCode) as { cost_price: number; shares: number; buy_date: string } | undefined;
    if (posRow) {
      positionData = {
        costPrice: posRow.cost_price,
        shares: posRow.shares,
        buyDate: posRow.buy_date,
      };
    }
  } catch {
    // Position data not available
  }

  // 5. Get risk alerts
  let riskAlerts: string[] = [];
  try {
    const alerts = detectRiskAlerts(stockCode, database);
    riskAlerts = alerts.map((a) => a.label);
  } catch {
    // Risk alerts not available
  }

  return {
    stockCode,
    stockName: quote.stockName,
    marketData: {
      price: quote.price,
      changePercent: quote.changePercent,
      volume: quote.volume,
    },
    technicalIndicators,
    newsItems: newsItems.length > 0 ? newsItems : undefined,
    positionData,
  };
}

// --- Trigger analysis ---

export async function triggerAnalysis(
  stockCode: string,
  userId: number,
  triggerType: 'scheduled' | 'volatility' | 'manual' | 'self_correction' = 'manual',
  db?: Database.Database
): Promise<AnalysisResponse> {
  if (!isValidStockCode(stockCode)) {
    throw Errors.badRequest('股票代码无效，请输入正确的A股代码（6位数字）');
  }

  const database = db || getDatabase();

  // Build context
  const context = await buildAnalysisContext(stockCode, userId, database);

  // Call AI provider
  const provider = getAIProvider();
  const result: AnalysisResult = await provider.analyze(context);

  // Cross-validate confidence with technical indicators and risk alerts
  let indicators: IndicatorData | null = null;
  try {
    indicators = getIndicators(stockCode, database);
  } catch {
    // indicators not available
  }

  let riskAlertObjects: RiskAlert[] = [];
  try {
    riskAlertObjects = detectRiskAlerts(stockCode, database);
  } catch {
    // ignore
  }

  let history: MarketHistoryRow[] = [];
  try {
    history = getMarketHistory(stockCode, database);
  } catch {
    // ignore
  }

  const crossValidation = crossValidateConfidence(result, indicators, riskAlertObjects, history);
  result.confidence = crossValidation.adjustedConfidence;

  // Merge cross-validation warnings into risk alerts
  const existingRiskAlerts = riskAlertObjects.map((a) => a.label);
  const allRiskAlerts = [...existingRiskAlerts, ...crossValidation.warnings.filter(
    (w) => !existingRiskAlerts.includes(w)
  )];

  // Save to analyses table
  const now = new Date().toISOString();
  const insertResult = database.prepare(
    `INSERT INTO analyses (
      user_id, stock_code, stock_name, trigger_type, stage, space_estimate,
      key_signals, action_ref, batch_plan, confidence, reasoning,
      data_sources, technical_indicators, news_summary,
      recovery_estimate, profit_estimate, risk_alerts, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    stockCode,
    context.stockName,
    triggerType,
    result.stage,
    result.spaceEstimate || null,
    JSON.stringify(result.keySignals),
    result.actionRef,
    JSON.stringify(result.batchPlan),
    result.confidence,
    result.reasoning,
    JSON.stringify(['market_data', 'technical_indicators', ...(context.newsItems ? ['news'] : [])]),
    JSON.stringify(context.technicalIndicators),
    context.newsItems ? JSON.stringify(context.newsItems.map((n) => n.title)) : null,
    null, // recovery_estimate - handled by task 10.4
    null, // profit_estimate - handled by task 10.4
    allRiskAlerts.length > 0 ? JSON.stringify(allRiskAlerts) : JSON.stringify(result.riskAlerts || []),
    now,
  );

  const id = insertResult.lastInsertRowid as number;
  const row = database.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as AnalysisRow;
  return toAnalysisResponse(row);
}

// --- Get analysis history ---

export function getAnalysisHistory(
  stockCode: string,
  userId: number,
  limit: number = 10,
  db?: Database.Database
): AnalysisResponse[] {
  if (!isValidStockCode(stockCode)) {
    throw Errors.badRequest('股票代码无效，请输入正确的A股代码（6位数字）');
  }

  const database = db || getDatabase();
  const rows = database
    .prepare(
      'SELECT * FROM analyses WHERE user_id = ? AND stock_code = ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(userId, stockCode, limit) as AnalysisRow[];

  return rows.map(toAnalysisResponse);
}
