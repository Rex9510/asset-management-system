import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { Errors } from '../errors/AppError';
import { getAIProvider } from '../ai/aiProviderFactory';

// --- Types ---

export interface StopLossAlert {
  positionId: number;
  stockCode: string;
  stockName: string;
  stopLossPrice: number;
  currentPrice: number;
  triggered: boolean;
}

interface PositionWithStopLoss {
  id: number;
  user_id: number;
  stock_code: string;
  stock_name: string;
  cost_price: number | null;
  shares: number | null;
  buy_date: string | null;
  stop_loss_price: number;
}

// --- setStopLoss ---

/**
 * Set stop loss price for a position.
 * Validates price is positive, updates positions table, returns updated row.
 */
export function setStopLoss(
  positionId: number,
  userId: number,
  stopLossPrice: number,
  db?: Database.Database
) {
  const database = db || getDatabase();

  if (typeof stopLossPrice !== 'number' || stopLossPrice <= 0 || !isFinite(stopLossPrice)) {
    throw Errors.badRequest('止损价必须为正数');
  }

  const existing = database
    .prepare('SELECT * FROM positions WHERE id = ? AND user_id = ?')
    .get(positionId, userId) as Record<string, unknown> | undefined;

  if (!existing) {
    throw Errors.notFound('持仓记录不存在');
  }

  const now = new Date().toISOString();
  database
    .prepare('UPDATE positions SET stop_loss_price = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(stopLossPrice, now, positionId, userId);

  return database
    .prepare('SELECT * FROM positions WHERE id = ? AND user_id = ?')
    .get(positionId, userId) as Record<string, unknown>;
}

// --- checkStopLossAlerts ---

/**
 * Check all holding positions with stop_loss_price set for a user.
 * Returns array of alerts indicating which positions are triggered.
 */
export function checkStopLossAlerts(
  userId: number,
  db?: Database.Database
): StopLossAlert[] {
  const database = db || getDatabase();

  const positions = database
    .prepare(
      `SELECT id, user_id, stock_code, stock_name, stop_loss_price
       FROM positions
       WHERE user_id = ? AND position_type = 'holding' AND stop_loss_price IS NOT NULL`
    )
    .all(userId) as PositionWithStopLoss[];

  const alerts: StopLossAlert[] = [];

  for (const pos of positions) {
    const cache = database
      .prepare('SELECT price FROM market_cache WHERE stock_code = ?')
      .get(pos.stock_code) as { price: number } | undefined;

    if (!cache) continue;

    const currentPrice = cache.price;
    const triggered = currentPrice <= pos.stop_loss_price;

    alerts.push({
      positionId: pos.id,
      stockCode: pos.stock_code,
      stockName: pos.stock_name,
      stopLossPrice: pos.stop_loss_price,
      currentPrice,
      triggered,
    });
  }

  return alerts;
}


// --- checkAndNotifyStopLoss ---

/**
 * For all users with holding positions that have stop_loss_price set,
 * check if current price <= stop_loss_price.
 * If triggered and no recent (24h) stop_loss_alert message exists, create one.
 */
export function checkAndNotifyStopLoss(db?: Database.Database): void {
  const database = db || getDatabase();

  const positions = database
    .prepare(
      `SELECT id, user_id, stock_code, stock_name, stop_loss_price
       FROM positions
       WHERE position_type = 'holding' AND stop_loss_price IS NOT NULL`
    )
    .all() as PositionWithStopLoss[];

  for (const pos of positions) {
    const cache = database
      .prepare('SELECT price FROM market_cache WHERE stock_code = ?')
      .get(pos.stock_code) as { price: number } | undefined;

    if (!cache) continue;

    const currentPrice = cache.price;
    if (currentPrice > pos.stop_loss_price) continue;

    // Check for recent (24h) stop_loss_alert for this position
    const recentAlert = database
      .prepare(
        `SELECT id FROM messages
         WHERE user_id = ? AND type = 'stop_loss_alert' AND stock_code = ?
           AND created_at > datetime('now', '-24 hours')
         LIMIT 1`
      )
      .get(pos.user_id, pos.stock_code) as { id: number } | undefined;

    if (recentAlert) continue;

    const triggerTime = new Date().toISOString();
    const summary = `⚠️ ${pos.stock_name} 已触发止损线`;
    const detail = JSON.stringify({
      positionId: pos.id,
      stockCode: pos.stock_code,
      stockName: pos.stock_name,
      stopLossPrice: pos.stop_loss_price,
      currentPrice,
      triggerTime,
    });

    database
      .prepare(
        `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read)
         VALUES (?, 'stop_loss_alert', ?, ?, ?, ?, 0)`
      )
      .run(pos.user_id, pos.stock_code, pos.stock_name, summary, detail);
  }
}

// --- getAIStopLossEvaluation ---

/**
 * On-demand AI evaluation for stop loss (user clicks "详细评估").
 * Builds context and asks AI to review buy logic, assess fundamentals, provide reference plan.
 * Uses "参考方案" wording, NEVER "建议"/"推荐".
 */
export async function getAIStopLossEvaluation(
  stockCode: string,
  userId: number,
  db?: Database.Database
): Promise<string> {
  const database = db || getDatabase();

  // Get position data
  const position = database
    .prepare(
      `SELECT id, stock_code, stock_name, cost_price, shares, buy_date, stop_loss_price
       FROM positions
       WHERE user_id = ? AND stock_code = ? AND position_type = 'holding'
       LIMIT 1`
    )
    .get(userId, stockCode) as PositionWithStopLoss | undefined;

  // Get current price from market_cache
  const cache = database
    .prepare('SELECT price FROM market_cache WHERE stock_code = ?')
    .get(stockCode) as { price: number } | undefined;

  const currentPrice = cache?.price ?? 0;
  const stockName = position?.stock_name ?? stockCode;
  const costPrice = position?.cost_price ?? 0;
  const buyDate = position?.buy_date ?? '未知';
  const holdingDays = position?.buy_date
    ? Math.floor((Date.now() - new Date(position.buy_date + 'T00:00:00Z').getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Get technical indicators if available
  let technicalInfo = '';
  try {
    const indicators = database
      .prepare(
        `SELECT ma5, ma10, ma20, ma60, rsi6, rsi12, dif, dea, macd_histogram
         FROM technical_indicators
         WHERE stock_code = ?
         ORDER BY trade_date DESC LIMIT 1`
      )
      .get(stockCode) as Record<string, number | null> | undefined;

    if (indicators) {
      const parts: string[] = [];
      if (indicators.ma5 != null) parts.push(`MA5=${indicators.ma5}`);
      if (indicators.ma20 != null) parts.push(`MA20=${indicators.ma20}`);
      if (indicators.ma60 != null) parts.push(`MA60=${indicators.ma60}`);
      if (indicators.rsi6 != null) parts.push(`RSI6=${indicators.rsi6}`);
      if (indicators.dif != null) parts.push(`MACD DIF=${indicators.dif}`);
      if (parts.length > 0) technicalInfo = `技术指标：${parts.join(', ')}`;
    }
  } catch {
    // Technical indicators not available
  }

  // Build prompt
  const stopLossPart = position?.stop_loss_price
    ? `当前止损价：${position.stop_loss_price}元`
    : '当前未设置止损价，请在分析中给出参考止损价';

  const contextLines = [
    `股票：${stockName}(${stockCode})`,
    `当前价：${currentPrice}元`,
    `成本价：${costPrice}元`,
    `买入日期：${buyDate}`,
    `持有天数：${holdingDays}天`,
    stopLossPart,
  ];
  if (technicalInfo) contextLines.push(technicalInfo);

  const userMessage = contextLines.join('\n');

  const systemPrompt = [
    '你是一位专业的投资分析助手。请根据以下持仓信息进行止损评估分析。',
    '分析内容必须包含以下三部分：',
    '1. 买入逻辑回顾：回顾当初买入的可能原因',
    '2. 基本面变化评估：评估当前基本面是否发生重大变化',
    '3. 参考方案：给出持有或止损的参考方案',
    '',
    '如果用户未设置止损价，请在参考方案中给出一个参考止损价。',
    '',
    '重要：所有输出必须使用"参考方案"措辞，禁止使用"建议"或"推荐"。',
    '输出应客观中性，不含批评或指责性语言。',
  ].join('\n');

  const provider = getAIProvider();
  const result = await provider.chat(
    [{ role: 'user', content: userMessage }],
    systemPrompt
  );

  return result;
}
