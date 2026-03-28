/**
 * 每日关注选股服务
 * 第一步：代码按技术指标过滤沪深300候选池
 * 第二步：AI 从候选池按短期/中期/中长期各精选1只
 * 结果存入 messages 表（type='daily_pick'）
 */
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { getMarketHistory, MarketHistoryRow } from '../indicators/indicatorService';
import { detectRiskAlerts } from '../indicators/riskDetectionService';
import { getAIProvider } from '../ai/aiProviderFactory';
import { getQuote } from '../market/marketDataService';

// --- Types ---

export interface CandidateStock {
  stockCode: string;
  stockName: string;
  weight: number;
  latestClose: number;
  indicators: {
    macdGoldenCross: boolean;
    macdNearCross: boolean;
    rsiInRange: boolean;
    volumeExpanding: boolean;
    priceAboveMA20: boolean;
  };
  matchCount: number;
}

export interface DailyPick {
  stockCode: string;
  stockName: string;
  period: 'short' | 'mid' | 'long';
  periodLabel: string;
  reason: string;
  targetPriceRange: { low: number; high: number };
  estimatedUpside: number;
}

// --- Technical indicator filter functions ---

/**
 * Check MACD golden cross: DIF > DEA (golden cross) or DIF approaching DEA from below (near cross)
 */
export function checkMACDCondition(dif: number | null, dea: number | null): { goldenCross: boolean; nearCross: boolean } {
  if (dif === null || dea === null) return { goldenCross: false, nearCross: false };
  const goldenCross = dif > dea;
  // Near cross: DIF is below DEA but within 0.05 distance (approaching from below)
  const nearCross = !goldenCross && (dea - dif) < 0.05 && (dea - dif) >= 0;
  return { goldenCross, nearCross };
}

/**
 * Check RSI is in 30-70 range (healthy zone)
 */
export function checkRSICondition(rsi12: number | null): boolean {
  if (rsi12 === null) return false;
  return rsi12 >= 30 && rsi12 <= 70;
}

/**
 * Check if volume expanded in last 5 days compared to prior 5 days
 */
export function checkVolumeExpansion(history: MarketHistoryRow[]): boolean {
  if (history.length < 10) return false;
  const recent5 = history.slice(-5);
  const prior5 = history.slice(-10, -5);
  const recentAvg = recent5.reduce((s, r) => s + r.volume, 0) / 5;
  const priorAvg = prior5.reduce((s, r) => s + r.volume, 0) / 5;
  if (priorAvg === 0) return false;
  return recentAvg > priorAvg * 1.1; // Volume increased by >10%
}

/**
 * Check if price is near or above MA20
 * "Near" means within 3% below MA20; "above" means at or above MA20
 */
export function checkPriceNearMA20(closePrice: number, ma20: number | null): boolean {
  if (ma20 === null || ma20 === 0) return false;
  const diff = (closePrice - ma20) / ma20;
  return diff >= -0.03; // At or above MA20, or within 3% below
}


// --- Core filtering logic ---

/**
 * Filter HS300 candidates by technical indicators and risk detection.
 * Returns candidates that pass at least 3 of 4 technical conditions and have no risk alerts.
 */
export function filterCandidates(db?: Database.Database): CandidateStock[] {
  const database = db || getDatabase();

  // Step 1: Get all HS300 constituents
  const constituents = database
    .prepare('SELECT stock_code, stock_name, weight FROM hs300_constituents')
    .all() as { stock_code: string; stock_name: string; weight: number }[];

  if (constituents.length === 0) return [];

  const candidates: CandidateStock[] = [];

  for (const stock of constituents) {
    try {
      // Get latest technical indicators
      const indicator = database
        .prepare(
          'SELECT dif, dea, rsi12, ma20 FROM technical_indicators WHERE stock_code = ? ORDER BY trade_date DESC LIMIT 1'
        )
        .get(stock.stock_code) as { dif: number | null; dea: number | null; rsi12: number | null; ma20: number | null } | undefined;

      if (!indicator) continue;

      // Get market history for volume check
      const history = getMarketHistory(stock.stock_code, database);
      if (history.length < 10) continue;

      const latestClose = history[history.length - 1].close_price;

      // Check all 4 conditions
      const { goldenCross, nearCross } = checkMACDCondition(indicator.dif, indicator.dea);
      const macdOk = goldenCross || nearCross;
      const rsiOk = checkRSICondition(indicator.rsi12);
      const volumeOk = checkVolumeExpansion(history);
      const priceOk = checkPriceNearMA20(latestClose, indicator.ma20);

      const matchCount = [macdOk, rsiOk, volumeOk, priceOk].filter(Boolean).length;

      // Must match at least 3 of 4 conditions
      if (matchCount < 3) continue;

      // Step 2: Exclude stocks with risk alerts
      const riskAlerts = detectRiskAlerts(stock.stock_code, database);
      if (riskAlerts.length > 0) continue;

      candidates.push({
        stockCode: stock.stock_code,
        stockName: stock.stock_name,
        weight: stock.weight,
        latestClose,
        indicators: {
          macdGoldenCross: goldenCross,
          macdNearCross: nearCross,
          rsiInRange: rsiOk,
          volumeExpanding: volumeOk,
          priceAboveMA20: priceOk,
        },
        matchCount,
      });
    } catch {
      // Skip stocks that fail indicator calculation
      continue;
    }
  }

  // Sort by match count desc, then weight desc
  candidates.sort((a, b) => b.matchCount - a.matchCount || b.weight - a.weight);

  return candidates;
}

// --- AI selection logic ---

/**
 * Use AI to select 3 stocks from candidates: 1 short-term, 1 mid-term, 1 long-term.
 * Each pick includes reason (≥2 dimensions), target price range, estimated upside.
 */
export async function generateDailyPicks(userId: number, db?: Database.Database): Promise<DailyPick[]> {
  const database = db || getDatabase();
  const candidates = filterCandidates(database);
  const aiProvider = getAIProvider();

  const systemPrompt = `你是一个专业的A股投资分析助手。请从候选股票池中按短期（1-2周波段）、中期（1-3个月趋势）、中长期（3个月以上价值）各精选1只股票。
要求：
1. 使用"参考方案"措辞，禁止使用"建议""推荐"等投资顾问措辞
2. 每只股票的关注理由必须包含至少2个维度（技术面、基本面、市场情绪等）
3. 必须给出预估目标价位区间和预估上升空间百分比
4. 返回严格的 JSON 数组格式，每个元素包含：stockCode, stockName, period("short"/"mid"/"long"), reason, targetPriceLow, targetPriceHigh, estimatedUpside
5. 仅供学习参考，不构成投资依据`;

  let userMessage: string;

  if (candidates.length > 0) {
    const candidateInfo = candidates.slice(0, 20).map(c => ({
      stockCode: c.stockCode,
      stockName: c.stockName,
      latestClose: c.latestClose,
      weight: c.weight,
      indicators: c.indicators,
      matchCount: c.matchCount,
    }));

    userMessage = `以下是通过技术指标筛选的沪深300候选股票池（已排除主力诱导风险）：
${JSON.stringify(candidateInfo, null, 2)}

请从中按短期/中期/中长期各精选1只，返回JSON数组。`;
  } else {
    // No candidates from technical filtering — ask AI to pick from HS300 constituents directly
    const constituents = database
      .prepare('SELECT stock_code, stock_name, weight FROM hs300_constituents ORDER BY weight DESC LIMIT 30')
      .all() as { stock_code: string; stock_name: string; weight: number }[];

    if (constituents.length === 0) return [];

    // Fetch current prices for top constituents so AI can give realistic target prices
    const stockListWithPrices: { stockCode: string; stockName: string; weight: number; currentPrice?: number }[] = [];
    for (const c of constituents) {
      const item: { stockCode: string; stockName: string; weight: number; currentPrice?: number } = {
        stockCode: c.stock_code,
        stockName: c.stock_name,
        weight: c.weight,
      };
      try {
        const quote = await getQuote(c.stock_code.replace(/\.\w+$/, ''));
        item.currentPrice = quote.price;
      } catch {
        // skip price if fetch fails
      }
      stockListWithPrices.push(item);
    }

    userMessage = `当前暂无技术指标数据，请从以下沪深300权重股中，基于你的市场知识按短期/中期/中长期各精选1只进行关注分析。
注意：currentPrice是当前实时价格，你给出的目标价位必须基于当前价格合理推算，不要凭空编造。
${JSON.stringify(stockListWithPrices, null, 2)}

请返回JSON数组。`;
  }

  try {
    const response = await aiProvider.chat(
      [{ role: 'user', content: userMessage }],
      systemPrompt
    );

    const picks = parseAIPicksResponse(response, candidates);

    // Store results in messages table
    for (const pick of picks) {
      const summary = `【${pick.periodLabel}】${pick.stockName}(${pick.stockCode}) 目标价${pick.targetPriceRange.low}-${pick.targetPriceRange.high}元，预估上升空间${pick.estimatedUpside}%`;
      const detail = JSON.stringify(pick);

      database.prepare(
        `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read)
         VALUES (?, 'daily_pick', ?, ?, ?, ?, 0)`
      ).run(userId, pick.stockCode, pick.stockName, summary, detail);
    }

    return picks;
  } catch {
    return [];
  }
}

/**
 * Parse AI response into DailyPick array.
 * Falls back to selecting top candidates if AI response is unparseable.
 */
export function parseAIPicksResponse(response: string, candidates: CandidateStock[]): DailyPick[] {
  const periodLabels: Record<string, string> = {
    short: '短期关注(1-2周)',
    mid: '中期关注(1-3个月)',
    long: '中长期关注(3个月+)',
  };

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);

    if (!Array.isArray(parsed)) throw new Error('Not an array');

    const picks: DailyPick[] = [];
    const usedPeriods = new Set<string>();
    const usedCodes = new Set<string>();

    for (const item of parsed) {
      const period = item.period as 'short' | 'mid' | 'long';
      if (!['short', 'mid', 'long'].includes(period)) continue;
      if (usedPeriods.has(period)) continue;
      if (usedCodes.has(item.stockCode)) continue;

      // Validate the stock is in candidates (skip validation if no candidates)
      const candidate = candidates.length > 0
        ? candidates.find(c => c.stockCode === item.stockCode)
        : null;
      if (candidates.length > 0 && !candidate) continue;

      const basePrice = candidate?.latestClose || 10;
      const targetLow = Number(item.targetPriceLow) || basePrice * 1.05;
      const targetHigh = Number(item.targetPriceHigh) || basePrice * 1.15;
      const upside = Number(item.estimatedUpside) || Math.round(((targetHigh + targetLow) / 2 / basePrice - 1) * 100);

      picks.push({
        stockCode: item.stockCode,
        stockName: item.stockName || candidate?.stockName || item.stockCode,
        period,
        periodLabel: periodLabels[period],
        reason: item.reason || '技术面和基本面综合分析',
        targetPriceRange: { low: targetLow, high: targetHigh },
        estimatedUpside: upside > 0 ? upside : 5,
      });

      usedPeriods.add(period);
      usedCodes.add(item.stockCode);
    }

    // If AI didn't provide all 3 periods, fill from candidates
    if (picks.length < 3 && candidates.length > 0) {
      return fillMissingPicks(picks, candidates, periodLabels);
    }

    return picks;
  } catch {
    // Fallback: select top 3 candidates
    return fallbackPicks(candidates, periodLabels);
  }
}

function fillMissingPicks(
  existing: DailyPick[],
  candidates: CandidateStock[],
  periodLabels: Record<string, string>
): DailyPick[] {
  const periods: ('short' | 'mid' | 'long')[] = ['short', 'mid', 'long'];
  const usedPeriods = new Set(existing.map(p => p.period));
  const usedCodes = new Set(existing.map(p => p.stockCode));
  const result = [...existing];

  for (const period of periods) {
    if (usedPeriods.has(period)) continue;
    const candidate = candidates.find(c => !usedCodes.has(c.stockCode));
    if (!candidate) break;

    result.push(buildFallbackPick(candidate, period, periodLabels));
    usedCodes.add(candidate.stockCode);
  }

  return result;
}

function fallbackPicks(
  candidates: CandidateStock[],
  periodLabels: Record<string, string>
): DailyPick[] {
  const periods: ('short' | 'mid' | 'long')[] = ['short', 'mid', 'long'];
  const picks: DailyPick[] = [];

  for (let i = 0; i < Math.min(3, candidates.length); i++) {
    picks.push(buildFallbackPick(candidates[i], periods[i], periodLabels));
  }

  return picks;
}

function buildFallbackPick(
  candidate: CandidateStock,
  period: 'short' | 'mid' | 'long',
  periodLabels: Record<string, string>
): DailyPick {
  const multiplier = period === 'short' ? 1.05 : period === 'mid' ? 1.10 : 1.15;
  const multiplierHigh = period === 'short' ? 1.10 : period === 'mid' ? 1.18 : 1.25;
  const low = Math.round(candidate.latestClose * multiplier * 100) / 100;
  const high = Math.round(candidate.latestClose * multiplierHigh * 100) / 100;
  const upside = Math.round(((low + high) / 2 / candidate.latestClose - 1) * 100);

  return {
    stockCode: candidate.stockCode,
    stockName: candidate.stockName,
    period,
    periodLabel: periodLabels[period],
    reason: buildFallbackReason(candidate),
    targetPriceRange: { low, high },
    estimatedUpside: upside > 0 ? upside : 5,
  };
}

function buildFallbackReason(candidate: CandidateStock): string {
  const reasons: string[] = [];
  if (candidate.indicators.macdGoldenCross) reasons.push('MACD金叉形成，短期动能转强');
  if (candidate.indicators.macdNearCross) reasons.push('MACD即将金叉，技术面有转多迹象');
  if (candidate.indicators.rsiInRange) reasons.push('RSI处于健康区间，未超买超卖');
  if (candidate.indicators.volumeExpanding) reasons.push('近5日成交量放大，资金关注度提升');
  if (candidate.indicators.priceAboveMA20) reasons.push('股价在MA20附近或上方，中期趋势偏多');
  return reasons.slice(0, 2).join('；') || '技术面和基本面综合分析';
}

// --- Job runner ---

/**
 * Run the daily pick job for all users.
 * Should be called before 9:15 each trading day.
 */
export async function runDailyPickJob(db?: Database.Database): Promise<void> {
  const database = db || getDatabase();

  // Get all user IDs
  const users = database.prepare('SELECT id FROM users').all() as { id: number }[];

  for (const user of users) {
    try {
      await generateDailyPicks(user.id, database);
    } catch {
      // Log error but continue for other users
      continue;
    }
  }
}
