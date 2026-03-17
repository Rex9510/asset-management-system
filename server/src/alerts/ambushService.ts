/**
 * 清仓后埋伏推荐服务
 * 用户删除持仓（视为清仓）后，从沪深300筛选低位候选标的
 * 通过AI生成完整分析，存入 messages 表（type='ambush_recommendation'）
 */
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { getAIProvider } from '../ai/aiProviderFactory';

// --- Types ---

export interface LowPositionCandidate {
  stockCode: string;
  stockName: string;
  weight: number;
  latestClose: number;
  rsi6: number;
  ma20: number;
  dif: number;
  dea: number;
  macdHistogram: number;
  /** RSI < 35 oversold score (lower = more oversold) */
  oversoldScore: number;
}

export interface AmbushRecommendation {
  stockCode: string;
  stockName: string;
  lowPositionReason: string;
  reboundPotential: string;
  buyPriceRange: { low: number; high: number };
  holdingPeriodRef: string;
}

// --- Core filtering: find low-position candidates from HS300 ---

/**
 * Find low-position candidates from HS300 constituents.
 * Criteria:
 *  - RSI6 < 35 (oversold)
 *  - Price below MA20
 *  - MACD near or at golden cross from below (DIF approaching DEA from below, or DIF just crossed above DEA with small histogram)
 * Returns up to 10 candidates sorted by oversold score (most oversold first).
 */
export function findLowPositionCandidates(db?: Database.Database): LowPositionCandidate[] {
  const database = db || getDatabase();

  const constituents = database
    .prepare('SELECT stock_code, stock_name, weight FROM hs300_constituents')
    .all() as { stock_code: string; stock_name: string; weight: number }[];

  if (constituents.length === 0) return [];

  const candidates: LowPositionCandidate[] = [];

  for (const stock of constituents) {
    try {
      // Get latest technical indicators
      const indicator = database
        .prepare(
          `SELECT rsi6, ma20, dif, dea, macd_histogram
           FROM technical_indicators
           WHERE stock_code = ? ORDER BY trade_date DESC LIMIT 1`
        )
        .get(stock.stock_code) as {
          rsi6: number | null;
          ma20: number | null;
          dif: number | null;
          dea: number | null;
          macd_histogram: number | null;
        } | undefined;

      if (!indicator) continue;
      if (indicator.rsi6 === null || indicator.ma20 === null || indicator.dif === null || indicator.dea === null) continue;

      // Get latest close price from market_history
      const latest = database
        .prepare(
          `SELECT close_price FROM market_history
           WHERE stock_code = ? ORDER BY trade_date DESC LIMIT 1`
        )
        .get(stock.stock_code) as { close_price: number } | undefined;

      if (!latest) continue;

      const { rsi6, ma20, dif, dea } = indicator;
      const macdHistogram = indicator.macd_histogram ?? 0;
      const latestClose = latest.close_price;

      // Condition 1: RSI6 < 35 (oversold)
      if (rsi6 >= 35) continue;

      // Condition 2: Price below MA20
      if (ma20 <= 0 || latestClose >= ma20) continue;

      // Condition 3: MACD near or at golden cross from below
      // Golden cross: DIF just crossed above DEA (histogram small positive)
      // Near cross: DIF below DEA but approaching (gap < 0.1)
      const isGoldenCross = dif > dea && macdHistogram >= 0 && macdHistogram < 0.3;
      const isNearCross = dif <= dea && (dea - dif) < 0.1;
      if (!isGoldenCross && !isNearCross) continue;

      candidates.push({
        stockCode: stock.stock_code,
        stockName: stock.stock_name,
        weight: stock.weight,
        latestClose,
        rsi6,
        ma20,
        dif,
        dea,
        macdHistogram,
        oversoldScore: rsi6, // Lower RSI = more oversold
      });
    } catch {
      continue;
    }
  }

  // Sort by oversold score ascending (most oversold first), then weight descending
  candidates.sort((a, b) => a.oversoldScore - b.oversoldScore || b.weight - a.weight);

  return candidates.slice(0, 10);
}


// --- AI-powered analysis generation ---

/**
 * Generate ambush recommendations for a user.
 * Selects 1-2 best low-position candidates and uses AI to generate analysis.
 * Stores results in messages table with type='ambush_recommendation'.
 */
export async function generateAmbushRecommendation(
  userId: number,
  db?: Database.Database
): Promise<AmbushRecommendation[]> {
  const database = db || getDatabase();
  const candidates = findLowPositionCandidates(database);

  if (candidates.length === 0) return [];

  // Select top 1-2 candidates
  const selected = candidates.slice(0, Math.min(2, candidates.length));

  const aiProvider = getAIProvider();

  const systemPrompt = `你是一个专业的A股投资分析助手。请对以下低位候选标的进行分析。
要求：
1. 使用"参考方案"措辞，禁止使用"建议""推荐"等投资顾问措辞
2. 对每只股票提供：当前处于低位的原因、预估反弹空间、参考买入价位区间、持仓周期参考
3. 返回严格的 JSON 数组格式，每个元素包含：stockCode, stockName, lowPositionReason, reboundPotential, buyPriceLow, buyPriceHigh, holdingPeriodRef
4. 仅供学习参考，不构成投资依据`;

  const candidateInfo = selected.map(c => ({
    stockCode: c.stockCode,
    stockName: c.stockName,
    latestClose: c.latestClose,
    rsi6: c.rsi6,
    ma20: c.ma20,
    dif: c.dif,
    dea: c.dea,
    macdHistogram: c.macdHistogram,
    priceBelowMA20Pct: Math.round(((c.ma20 - c.latestClose) / c.ma20) * 100 * 10) / 10,
  }));

  const userMessage = `以下是从沪深300中筛选出的低位候选标的（RSI超卖、股价低于MA20、MACD即将或刚刚金叉）：
${JSON.stringify(candidateInfo, null, 2)}

请对每只股票进行分析，返回JSON数组。`;

  try {
    const response = await aiProvider.chat(
      [{ role: 'user', content: userMessage }],
      systemPrompt
    );

    const recommendations = parseAIAmbushResponse(response, selected);

    // Store results in messages table
    for (const rec of recommendations) {
      const summary = `【埋伏参考】${rec.stockName}(${rec.stockCode}) 参考买入区间${rec.buyPriceRange.low}-${rec.buyPriceRange.high}元，${rec.holdingPeriodRef}`;
      const detail = JSON.stringify(rec);

      database.prepare(
        `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read)
         VALUES (?, 'ambush_recommendation', ?, ?, ?, ?, 0)`
      ).run(userId, rec.stockCode, rec.stockName, summary, detail);
    }

    return recommendations;
  } catch {
    // Fallback: generate basic recommendations without AI
    const fallbackRecs = selected.map(c => buildFallbackRecommendation(c));

    for (const rec of fallbackRecs) {
      const summary = `【埋伏参考】${rec.stockName}(${rec.stockCode}) 参考买入区间${rec.buyPriceRange.low}-${rec.buyPriceRange.high}元，${rec.holdingPeriodRef}`;
      const detail = JSON.stringify(rec);

      database.prepare(
        `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read)
         VALUES (?, 'ambush_recommendation', ?, ?, ?, ?, 0)`
      ).run(userId, rec.stockCode, rec.stockName, summary, detail);
    }

    return fallbackRecs;
  }
}

/**
 * Parse AI response into AmbushRecommendation array.
 */
export function parseAIAmbushResponse(
  response: string,
  candidates: LowPositionCandidate[]
): AmbushRecommendation[] {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);

    if (!Array.isArray(parsed)) throw new Error('Not an array');

    const recommendations: AmbushRecommendation[] = [];

    for (const item of parsed) {
      const candidate = candidates.find(c => c.stockCode === item.stockCode);
      if (!candidate) continue;

      const buyLow = Number(item.buyPriceLow) || Math.round(candidate.latestClose * 0.95 * 100) / 100;
      const buyHigh = Number(item.buyPriceHigh) || Math.round(candidate.latestClose * 1.02 * 100) / 100;

      recommendations.push({
        stockCode: item.stockCode,
        stockName: item.stockName || candidate.stockName,
        lowPositionReason: item.lowPositionReason || buildFallbackLowReason(candidate),
        reboundPotential: item.reboundPotential || `预估反弹空间${Math.round(((candidate.ma20 - candidate.latestClose) / candidate.latestClose) * 100)}%`,
        buyPriceRange: { low: buyLow, high: buyHigh },
        holdingPeriodRef: item.holdingPeriodRef || '参考持仓周期2-4周',
      });

      if (recommendations.length >= 2) break;
    }

    // If AI didn't return valid results, use fallback
    if (recommendations.length === 0) {
      return candidates.slice(0, 2).map(c => buildFallbackRecommendation(c));
    }

    return recommendations;
  } catch {
    return candidates.slice(0, 2).map(c => buildFallbackRecommendation(c));
  }
}

function buildFallbackRecommendation(candidate: LowPositionCandidate): AmbushRecommendation {
  const buyLow = Math.round(candidate.latestClose * 0.95 * 100) / 100;
  const buyHigh = Math.round(candidate.latestClose * 1.02 * 100) / 100;

  return {
    stockCode: candidate.stockCode,
    stockName: candidate.stockName,
    lowPositionReason: buildFallbackLowReason(candidate),
    reboundPotential: `预估反弹空间${Math.round(((candidate.ma20 - candidate.latestClose) / candidate.latestClose) * 100)}%`,
    buyPriceRange: { low: buyLow, high: buyHigh },
    holdingPeriodRef: '参考持仓周期2-4周',
  };
}

function buildFallbackLowReason(candidate: LowPositionCandidate): string {
  const reasons: string[] = [];
  reasons.push(`RSI6为${candidate.rsi6.toFixed(1)}，处于超卖区间`);
  const belowPct = ((candidate.ma20 - candidate.latestClose) / candidate.ma20 * 100).toFixed(1);
  reasons.push(`股价低于MA20约${belowPct}%，存在均线回归动力`);
  if (candidate.dif > candidate.dea) {
    reasons.push('MACD刚刚金叉，短期动能有转多迹象');
  } else {
    reasons.push('MACD即将金叉，底部信号初现');
  }
  return reasons.join('；');
}

// --- Trigger on clearance ---

/**
 * Trigger ambush recommendation when a user clears a position (deletes it).
 * This should be called from the position deletion handler.
 */
export async function triggerAmbushOnClearance(
  userId: number,
  clearedStockCode: string,
  db?: Database.Database
): Promise<AmbushRecommendation[]> {
  return generateAmbushRecommendation(userId, db);
}
