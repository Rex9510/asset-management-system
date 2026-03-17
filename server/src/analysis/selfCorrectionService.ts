import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { triggerAnalysis, AnalysisRow } from './analysisService';
import { getQuote } from '../market/marketDataService';

// --- Types ---

export interface DeviationReport {
  analysisId: number;
  stockCode: string;
  stockName: string;
  predictedStage: string;
  predictedAction: string;
  actualChangePercent: number;
  deviationReason: string;
  severity: 'moderate' | 'severe';
}

// --- Constants ---

const LOOKBACK_DAYS = 7;
const MODERATE_DEVIATION_THRESHOLD = 5; // 5% price drop when predicted rising/add
const SEVERE_DEVIATION_THRESHOLD = 10;  // 10% deviation

// --- Deviation detection ---

/**
 * Detect if a historical analysis has significant deviation from actual price movement.
 * Returns a DeviationReport if deviation found, null otherwise.
 */
function detectDeviation(
  analysis: AnalysisRow,
  currentPrice: number,
  analysisPrice: number
): DeviationReport | null {
  const priceChange = ((currentPrice - analysisPrice) / analysisPrice) * 100;

  // Check for bullish prediction but price dropped significantly
  const bullishStages = ['rising', 'main_wave', 'bottom'];
  const bullishActions = ['add', 'hold'];
  const isBullishPrediction =
    bullishStages.includes(analysis.stage) || bullishActions.includes(analysis.action_ref);

  // Check for bearish prediction but price rose significantly
  const bearishActions = ['reduce', 'clear'];
  const isBearishPrediction =
    bearishActions.includes(analysis.action_ref) || analysis.stage === 'falling';

  let deviationReason = '';
  let severity: 'moderate' | 'severe' = 'moderate';

  if (isBullishPrediction && priceChange < -MODERATE_DEVIATION_THRESHOLD) {
    severity = priceChange < -SEVERE_DEVIATION_THRESHOLD ? 'severe' : 'moderate';
    deviationReason =
      `历史分析判断阶段为"${analysis.stage}"、操作参考为"${analysis.action_ref}"，` +
      `但实际价格下跌${Math.abs(priceChange).toFixed(2)}%，与看多预判存在明显偏差`;
  } else if (isBearishPrediction && priceChange > MODERATE_DEVIATION_THRESHOLD) {
    severity = priceChange > SEVERE_DEVIATION_THRESHOLD ? 'severe' : 'moderate';
    deviationReason =
      `历史分析判断阶段为"${analysis.stage}"、操作参考为"${analysis.action_ref}"，` +
      `但实际价格上涨${priceChange.toFixed(2)}%，与看空预判存在明显偏差`;
  } else {
    return null;
  }

  return {
    analysisId: analysis.id,
    stockCode: analysis.stock_code,
    stockName: analysis.stock_name,
    predictedStage: analysis.stage,
    predictedAction: analysis.action_ref,
    actualChangePercent: priceChange,
    deviationReason,
    severity,
  };
}


// --- Get analysis price at time of analysis ---

function getAnalysisPrice(analysis: AnalysisRow, db: Database.Database): number | null {
  // Try to get the price from technical_indicators stored with the analysis
  if (analysis.technical_indicators) {
    try {
      const indicators = JSON.parse(analysis.technical_indicators);
      if (indicators?.ma?.ma5) {
        return indicators.ma.ma5; // Use MA5 as proxy for price at analysis time
      }
    } catch {
      // ignore parse errors
    }
  }

  // Fallback: check market_history for the analysis date
  const analysisDate = analysis.created_at.split('T')[0];
  const histRow = db
    .prepare('SELECT close_price FROM market_history WHERE stock_code = ? AND trade_date <= ? ORDER BY trade_date DESC LIMIT 1')
    .get(analysis.stock_code, analysisDate) as { close_price: number } | undefined;

  return histRow?.close_price ?? null;
}

// --- Main exported functions ---

/**
 * Check historical analyses for a specific stock and user, detect deviations,
 * and generate self-correction reports if needed.
 */
export async function checkAnalysisDeviation(
  stockCode: string,
  userId: number,
  db?: Database.Database
): Promise<DeviationReport[]> {
  const database = db || getDatabase();

  // 1. Get historical analyses from past LOOKBACK_DAYS days (exclude self_correction type)
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - LOOKBACK_DAYS);
  const cutoffStr = cutoffDate.toISOString();

  const analyses = database
    .prepare(
      `SELECT * FROM analyses
       WHERE stock_code = ? AND user_id = ? AND trigger_type != 'self_correction'
         AND created_at >= ?
       ORDER BY created_at DESC`
    )
    .all(stockCode, userId, cutoffStr) as AnalysisRow[];

  if (analyses.length === 0) return [];

  // 2. Get current market price
  let currentPrice: number;
  try {
    const quote = await getQuote(stockCode, database);
    currentPrice = quote.price;
  } catch {
    return []; // Cannot check deviation without current price
  }

  // 3. Check each analysis for deviation
  const deviations: DeviationReport[] = [];

  for (const analysis of analyses) {
    const analysisPrice = getAnalysisPrice(analysis, database);
    if (analysisPrice === null || analysisPrice <= 0) continue;

    const deviation = detectDeviation(analysis, currentPrice, analysisPrice);
    if (!deviation) continue;

    deviations.push(deviation);

    // 4. Generate self-correction analysis
    try {
      const correctionAnalysis = await triggerAnalysis(stockCode, userId, 'self_correction', database);

      // 5. Store correction message in messages table
      database.prepare(
        `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, analysis_id, created_at)
         VALUES (?, 'self_correction', ?, ?, ?, ?, ?, ?)`
      ).run(
        userId,
        stockCode,
        analysis.stock_name,
        `自我修正：${analysis.stock_name}(${stockCode}) - ${deviation.deviationReason}`,
        JSON.stringify({
          originalAnalysisId: analysis.id,
          deviationReason: deviation.deviationReason,
          severity: deviation.severity,
          predictedStage: deviation.predictedStage,
          predictedAction: deviation.predictedAction,
          actualChangePercent: deviation.actualChangePercent,
          correctedStage: correctionAnalysis.stage,
          correctedAction: correctionAnalysis.actionRef,
          correctedReasoning: correctionAnalysis.reasoning,
        }),
        correctionAnalysis.id,
        new Date().toISOString()
      );
    } catch {
      // Correction analysis failure should not stop processing
    }

    // Only generate one correction per stock per check (use the most recent analysis)
    break;
  }

  return deviations;
}

/**
 * Batch check all recent analyses for deviations.
 * Finds all distinct stock+user combinations with recent analyses and checks each.
 */
export async function runSelfCorrectionCheck(
  db?: Database.Database
): Promise<number> {
  const database = db || getDatabase();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - LOOKBACK_DAYS);
  const cutoffStr = cutoffDate.toISOString();

  // Get distinct stock+user combinations with recent analyses
  const pairs = database
    .prepare(
      `SELECT DISTINCT stock_code, user_id FROM analyses
       WHERE trigger_type != 'self_correction' AND created_at >= ?`
    )
    .all(cutoffStr) as { stock_code: string; user_id: number }[];

  let correctionCount = 0;

  for (const pair of pairs) {
    try {
      const deviations = await checkAnalysisDeviation(pair.stock_code, pair.user_id, database);
      correctionCount += deviations.length;
    } catch {
      // Individual check failure should not stop the batch
    }
  }

  return correctionCount;
}
