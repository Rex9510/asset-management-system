import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { getAIProvider } from '../ai/aiProviderFactory';
import { AnalysisContext, AnalysisResult } from '../ai/aiProvider';
import { getQuote } from '../market/marketDataService';
import { getIndicators, getMarketHistory, IndicatorData, MarketHistoryRow } from '../indicators/indicatorService';
import { detectRiskAlerts, RiskAlert } from '../indicators/riskDetectionService';
import { getNews } from '../news/newsService';
import { crossValidateConfidence } from './confidenceService';
import { generateBatchPlan } from './batchPlanService';
import { estimateRecovery, estimateProfit } from './estimateService';
import { getUserTrustLevel, filterActionByTrust, isNewUser, generateColdStartRecords } from './trustService';
import { Errors } from '../errors/AppError';
import { isValidStockCode } from '../positions/positionService';
import { getValuationFromDb } from '../valuation/valuationService';
import { getCurrentRotation } from '../rotation/rotationService';
import { getCurrentChainStatus } from '../chain/commodityChainService';
import { getCurrentSentiment } from '../sentiment/sentimentService';
import { getEvents } from '../events/eventCalendarService';
import { getCurrentMarketEnv } from '../marketenv/marketEnvService';

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
  market_price: number | null;
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


// --- 周期品相关ETF代码（用于判断是否注入传导链状态） ---
const CYCLICAL_ETF_CODES = new Set([
  '512400', // 有色
  '515220', // 煤炭
  '516020', // 化工
  '159886', // 橡胶
  '161129', // 原油
  '518880', // 黄金
  '161226', // 白银
]);

// --- Build additional context string for AI prompt ---

export function buildAdditionalContextString(
  stockCode: string,
  valuation: { pePercentile: number; pbPercentile: number; peZone: string; pbZone: string; dataYears: number } | null,
  rotation: { currentPhase: string; phaseLabel: string } | null,
  chainStatus: { nodes: { name: string; shortName: string; status: string; change10d: number }[] } | null,
  sentiment: { score: number; label: string } | null,
  events: { name: string; windowStatus: string; windowLabel: string }[],
): string {
  const parts: string[] = [];

  // 估值分位
  if (valuation) {
    parts.push(`估值分位: PE${valuation.pePercentile.toFixed(0)}%分位(${valuation.peZone}), PB${valuation.pbPercentile.toFixed(0)}%分位(${valuation.pbZone}), ${valuation.dataYears}年数据`);
  }

  // 板块轮动阶段
  if (rotation) {
    let rotationLine = `当前轮动阶段: ${rotation.currentPhase} ${rotation.phaseLabel}`;
    // 判断股票是否处于当前活跃板块 → 提高关注度
    const isInActiveRotation = isCyclicalStock(stockCode) && rotation.currentPhase === 'P2';
    if (isInActiveRotation) {
      rotationLine += ' [该股处于当前活跃轮动板块，关注度提高]';
    }
    parts.push(rotationLine);
  }

  // 商品传导链状态（仅周期品注入）
  if (chainStatus && isCyclicalStock(stockCode)) {
    const chainSummary = chainStatus.nodes
      .map(n => `${n.shortName}:${n.status === 'activated' ? '激活' : n.status === 'transmitting' ? '传导中' : '未激活'}`)
      .join('→');
    parts.push(`传导链: ${chainSummary}`);
  }

  // 市场情绪
  if (sentiment) {
    parts.push(`市场情绪: ${sentiment.score}(${sentiment.label})`);
  }

  // 近期相关事件
  if (events.length > 0) {
    const eventLines = events
      .filter(e => e.windowStatus !== 'none')
      .slice(0, 3)
      .map(e => `${e.name}(${e.windowLabel})`);
    if (eventLines.length > 0) {
      parts.push(`近期事件: ${eventLines.join('; ')}`);
    }
  }

  return parts.join('\n');
}

/**
 * 判断股票是否为周期品相关（用于决定是否注入传导链状态）
 */
export function isCyclicalStock(stockCode: string): boolean {
  return CYCLICAL_ETF_CODES.has(stockCode);
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

  // 3. Get news — Prompt瘦身：仅保留标题，不发送完整摘要
  let newsItems: AnalysisContext['newsItems'] = [];
  try {
    const news = await getNews(stockCode, 5, database);
    newsItems = news.map((n) => ({
      title: n.title,
      summary: '',  // Prompt瘦身：不发送完整摘要，仅标题
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
      .prepare('SELECT cost_price, shares, buy_date FROM positions WHERE user_id = ? AND stock_code = ? AND position_type = \'holding\' LIMIT 1')
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

  // 6. 二期扩展：收集额外上下文数据
  let additionalContext: string | undefined;
  try {
    const valuation = getValuationFromDb(stockCode, database);
    const rotation = getCurrentRotation(database);
    const chainStatus = getCurrentChainStatus(database);
    const sentiment = getCurrentSentiment(database);
    const upcomingEvents = getEvents(7, database);

    const contextStr = buildAdditionalContextString(
      stockCode,
      valuation,
      rotation ? { currentPhase: rotation.currentPhase, phaseLabel: rotation.phaseLabel } : null,
      chainStatus,
      sentiment ? { score: sentiment.score, label: sentiment.label } : null,
      upcomingEvents,
    );

    if (contextStr.length > 0) {
      additionalContext = contextStr;
    }
  } catch {
    // Additional context not available — continue without
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
    additionalContext,
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

  // 二期：熊市环境下自动下调置信度（confidenceAdjust from marketEnvService）
  try {
    const marketEnv = getCurrentMarketEnv(database);
    if (marketEnv && marketEnv.confidenceAdjust !== 0) {
      result.confidence = Math.max(0, Math.min(100, result.confidence + marketEnv.confidenceAdjust));
    }
    if (marketEnv && marketEnv.riskTip && !allRiskAlerts.includes(marketEnv.riskTip)) {
      allRiskAlerts.push(marketEnv.riskTip);
    }
  } catch {
    // Market env not available — skip adjustment
  }

  // 二期：情绪指数极端值提示
  try {
    const sentiment = getCurrentSentiment(database);
    if (sentiment) {
      if (sentiment.score < 25) {
        const tip = '市场恐慌可能是低位布局机会';
        if (!allRiskAlerts.includes(tip)) {
          allRiskAlerts.push(tip);
        }
      } else if (sentiment.score >= 75) {
        const tip = '市场过热需警惕回调风险';
        if (!allRiskAlerts.includes(tip)) {
          allRiskAlerts.push(tip);
        }
      }
    }
  } catch {
    // Sentiment not available — skip
  }

  // Apply progressive trust strategy: filter actionRef based on user trust level
  const trustLevel = getUserTrustLevel(userId, database);
  result.actionRef = filterActionByTrust(result.actionRef, trustLevel);

  // Generate cold-start backtest records for new users
  if (isNewUser(userId, database) && context.stockName) {
    generateColdStartRecords(userId, stockCode, context.stockName, database);
  }

  // Generate batch plan for position-based analysis
  if (context.positionData) {
    const batchPlanResult = generateBatchPlan(
      context.positionData,
      context.marketData.price,
      result
    );
    // Override AI batch plan with position-aware batch plan
    result.batchPlan = batchPlanResult.batchPlan;
    // Merge batch plan warnings into risk alerts
    for (const w of batchPlanResult.warnings) {
      if (!allRiskAlerts.includes(w)) {
        allRiskAlerts.push(w);
      }
    }
  }

  // Generate recovery/profit estimates for positions
  let recoveryEstimateJson: string | null = null;
  let profitEstimateJson: string | null = null;

  if (context.positionData) {
    const profitPercent = ((context.marketData.price - context.positionData.costPrice) / context.positionData.costPrice) * 100;

    if (profitPercent < 0) {
      // Losing position → recovery estimate
      const recovery = estimateRecovery(
        context.positionData.costPrice,
        context.marketData.price,
        indicators,
        history
      );
      recoveryEstimateJson = JSON.stringify(recovery);
    } else {
      // Profitable position → profit estimate
      const profit = estimateProfit(
        context.positionData.costPrice,
        context.marketData.price,
        indicators,
        history
      );
      profitEstimateJson = JSON.stringify(profit);
    }
  }

  // Save to analyses table
  const now = new Date().toISOString();
  const insertResult = database.prepare(
    `INSERT INTO analyses (
      user_id, stock_code, stock_name, trigger_type, stage, space_estimate,
      key_signals, action_ref, batch_plan, confidence, reasoning,
      data_sources, technical_indicators, news_summary,
      recovery_estimate, profit_estimate, risk_alerts, market_price, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    recoveryEstimateJson,
    profitEstimateJson,
    allRiskAlerts.length > 0 ? JSON.stringify(allRiskAlerts) : JSON.stringify(result.riskAlerts || []),
    context.marketData.price,
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
