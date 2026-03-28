import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { getAIProvider } from '../ai/aiProviderFactory';
import { Errors } from '../errors/AppError';

// --- Types ---

export interface ChatMessageRow {
  id: number;
  user_id: number;
  role: 'user' | 'assistant';
  content: string;
  stock_code: string | null;
  created_at: string;
}

export interface ChatMessageResponse {
  id: number;
  userId: number;
  role: 'user' | 'assistant';
  content: string;
  stockCode: string | null;
  createdAt: string;
}

export interface CalmDownEvaluation {
  buyLogicReview: string;
  sellJudgment: 'rational' | 'emotional';
  worstCaseEstimate: string;
  recommendation: string;
}

// --- Sell intent keywords ---

const SELL_KEYWORDS = ['卖', '清仓', '出', '割肉', '止损', '跑', '抛'];

// --- System prompt ---

const CHAT_SYSTEM_PROMPT = `你是一个AI投资陪伴助手，专注于A股市场分析。你可以回答关于任意A股股票的基本面信息、技术面分析和市场动态的问题。

重要规则：
- 所有回复中使用"参考方案"措辞，不使用"建议""推荐"等具有投资顾问含义的措辞
- 回复应客观、专业，基于数据分析
- 提醒用户投资有风险，分析仅供参考
- 使用通俗易懂的语言，适合投资小白理解`;

const CALM_DOWN_SYSTEM_PROMPT = `你是一个AI投资冷静机制评估助手。用户想要卖出股票，你需要帮助用户冷静分析。

请严格按照以下JSON格式返回评估结果，不要包含其他内容：
{
  "buyLogicReview": "回顾当初买入该股票的逻辑和理由",
  "sellJudgment": "rational 或 emotional",
  "worstCaseEstimate": "如果继续持有，最坏情况的预估",
  "recommendation": "基于分析的参考方案"
}

重要规则：
- buyLogicReview: 回顾买入逻辑，提醒用户当初为什么买入
- sellJudgment: 判断当前卖出是理性决策还是情绪驱动，只能是 "rational" 或 "emotional"
- worstCaseEstimate: 客观预估最坏情况
- recommendation: 使用"参考方案"措辞，不使用"建议""推荐"
- 所有文本使用中文`;

// --- Helpers ---

function toResponse(row: ChatMessageRow): ChatMessageResponse {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    stockCode: row.stock_code,
    createdAt: row.created_at,
  };
}


// --- Detect sell intent ---

export function detectSellIntent(content: string): boolean {
  return SELL_KEYWORDS.some((keyword) => content.includes(keyword));
}

// --- Send message ---

export async function sendMessage(
  userId: number,
  content: string,
  stockCode?: string,
  db?: Database.Database
): Promise<ChatMessageResponse> {
  const database = db || getDatabase();

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    throw Errors.badRequest('消息内容不能为空');
  }

  const trimmedContent = content.trim();
  const now = new Date().toISOString();

  // Save user message
  const userInsert = database.prepare(
    'INSERT INTO chat_messages (user_id, role, content, stock_code, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, 'user', trimmedContent, stockCode || null, now);

  // Build conversation context from recent history
  const recentMessages = database.prepare(
    'SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'
  ).all(userId) as { role: string; content: string }[];

  const messages = recentMessages.reverse().map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Call AI provider
  const provider = getAIProvider();
  let aiResponse: string;
  try {
    aiResponse = await provider.chat(messages, CHAT_SYSTEM_PROMPT);
  } catch (err) {
    console.error('[ChatService] AI调用失败:', err);
    throw Errors.internal('AI服务暂时不可用，请稍后重试');
  }

  // Save AI response
  const aiNow = new Date().toISOString();
  const aiInsert = database.prepare(
    'INSERT INTO chat_messages (user_id, role, content, stock_code, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, 'assistant', aiResponse, stockCode || null, aiNow);

  const aiRow = database.prepare('SELECT * FROM chat_messages WHERE id = ?').get(
    aiInsert.lastInsertRowid as number
  ) as ChatMessageRow;

  return toResponse(aiRow);
}

// --- Get chat history ---

export function getChatHistory(
  userId: number,
  limit: number = 50,
  db?: Database.Database
): ChatMessageResponse[] {
  const database = db || getDatabase();
  const rows = database.prepare(
    'SELECT * FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ).all(userId, limit) as ChatMessageRow[];

  // Return in chronological order
  return rows.reverse().map(toResponse);
}

// --- Evaluate calm down ---

export async function evaluateCalmDown(
  userId: number,
  stockCode: string,
  db?: Database.Database
): Promise<CalmDownEvaluation> {
  const database = db || getDatabase();

  if (!stockCode || typeof stockCode !== 'string') {
    throw Errors.badRequest('请提供股票代码');
  }

  // Get position info for context
  const position = database.prepare(
    'SELECT stock_code, stock_name, cost_price, shares, buy_date FROM positions WHERE user_id = ? AND stock_code = ? AND position_type = \'holding\' LIMIT 1'
  ).get(userId, stockCode.trim()) as {
    stock_code: string;
    stock_name: string;
    cost_price: number;
    shares: number;
    buy_date: string;
  } | undefined;

  const positionContext = position
    ? `用户持仓信息：股票代码${position.stock_code}，股票名称${position.stock_name}，成本价${position.cost_price}元，持有${position.shares}股，买入日期${position.buy_date}`
    : `用户查询的股票代码：${stockCode}，暂无持仓记录`;

  // Get recent chat context
  const recentChats = database.prepare(
    'SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 5'
  ).all(userId) as { role: string; content: string }[];

  const chatContext = recentChats.reverse().map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  chatContext.push({
    role: 'user',
    content: `请对以下持仓进行冷静评估。${positionContext}`,
  });

  const provider = getAIProvider();
  let aiResponse: string;
  try {
    aiResponse = await provider.chat(chatContext, CALM_DOWN_SYSTEM_PROMPT);
  } catch {
    throw Errors.internal('AI服务暂时不可用，请稍后重试');
  }

  // Parse AI response as JSON
  try {
    // Try to extract JSON from the response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found');
    }
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      buyLogicReview: parsed.buyLogicReview || '暂无买入逻辑回顾',
      sellJudgment: parsed.sellJudgment === 'rational' ? 'rational' : 'emotional',
      worstCaseEstimate: parsed.worstCaseEstimate || '暂无最坏情况预估',
      recommendation: parsed.recommendation || '参考方案：请综合考虑后决定',
    };
  } catch {
    // Fallback if AI doesn't return valid JSON
    return {
      buyLogicReview: '暂无买入逻辑回顾，请回忆当初买入的理由',
      sellJudgment: 'emotional',
      worstCaseEstimate: aiResponse || '暂无最坏情况预估',
      recommendation: '参考方案：冷静分析后再做决定，避免情绪化操作',
    };
  }
}
