/**
 * AI Provider 抽象层 - 统一接口定义
 * 所有 AI 提供者（DeepSeek/Claude/Qwen）均实现此接口
 * 业务代码仅依赖此接口，不直接耦合特定模型 API
 */

/** 对话消息 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** AI 分析上下文 */
export interface AnalysisContext {
  stockCode: string;
  stockName: string;
  marketData: {
    price: number;
    changePercent: number;
    volume?: number;
  };
  technicalIndicators: {
    ma?: { ma5: number; ma10: number; ma20: number; ma60: number };
    macd?: { dif: number; dea: number; histogram: number };
    kdj?: { k: number; d: number; j: number };
    rsi?: { rsi6: number; rsi12: number; rsi24: number };
  };
  newsItems?: { title: string; summary: string; source: string; publishedAt: string }[];
  positionData?: {
    costPrice: number;
    shares: number;
    buyDate: string;
  };
  userHistory?: string;
  /** 二期扩展：额外上下文数据（估值分位、轮动阶段、传导链、情绪、事件等） */
  additionalContext?: string;
}

/** AI 分析结果 */
export interface AnalysisResult {
  stage: 'bottom' | 'rising' | 'main_wave' | 'high' | 'falling';
  spaceEstimate: string;
  keySignals: string[];
  actionRef: 'hold' | 'add' | 'reduce' | 'clear';
  batchPlan: { action: 'buy' | 'sell'; shares: number; targetPrice: number; note: string }[];
  confidence: number;
  reasoning: string;
  riskAlerts?: string[];
}

/** AI Provider 统一接口 */
export interface AIProvider {
  /** 执行股票分析 */
  analyze(context: AnalysisContext): Promise<AnalysisResult>;
  /** 对话聊天 */
  chat(messages: ChatMessage[], systemPrompt?: string): Promise<string>;
  /** 获取当前模型名称 */
  getModelName(): string;
}
