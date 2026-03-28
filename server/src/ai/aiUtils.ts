/**
 * Shared AI utility functions used by all AI providers.
 * Extracted to avoid code duplication across DeepSeek/Claude/Qwen providers.
 */
import { AnalysisContext, AnalysisResult } from './aiProvider';

/**
 * Build the system prompt for stock analysis.
 * Shared across all AI providers.
 */
export function buildAnalysisSystemPrompt(): string {
  return `你是一个专业的A股投资分析助手。请基于提供的行情数据、技术指标和新闻信息进行分析。
要求：
1. 使用"参考方案"措辞，禁止使用"建议""推荐"等投资顾问措辞
2. 返回严格的 JSON 格式，包含以下字段：
   - stage: 当前阶段 (bottom/rising/main_wave/high/falling)
   - spaceEstimate: 空间预估描述
   - keySignals: 关键信号数组，至少2条
   - actionRef: 操作参考 (hold/add/reduce/clear)
   - confidence: 置信度 0-100 整数
   - reasoning: 详细的中文推理过程，至少100字，包含对技术指标、市场走势、关键信号的分析逻辑
   - riskAlerts: 风险提示数组
3. reasoning 字段非常重要，必须包含完整的分析推理链条，不能为空`;
}

/**
 * Build the user prompt for stock analysis from context.
 * Shared across all AI providers.
 */
export function buildAnalysisUserPrompt(context: AnalysisContext): string {
  // Prompt瘦身：仅发送关键指标 + 新闻标题（非全文摘要）
  const slimmedNews = (context.newsItems || []).map(n => n.title);
  const payload: Record<string, unknown> = {
    stockCode: context.stockCode,
    stockName: context.stockName,
    marketData: context.marketData,
    technicalIndicators: context.technicalIndicators,
    newsTitles: slimmedNews,
    positionData: context.positionData || null,
  };
  if (context.additionalContext) {
    payload.additionalContext = context.additionalContext;
  }
  return JSON.stringify(payload);
}

/**
 * Parse raw AI response text into a structured AnalysisResult.
 * Handles JSON extraction from mixed text, with graceful fallback.
 * Shared across all AI providers.
 */
export function parseAnalysisResult(raw: string): AnalysisResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    return {
      stage: parsed.stage || 'bottom',
      spaceEstimate: parsed.spaceEstimate || '',
      keySignals: Array.isArray(parsed.keySignals) ? parsed.keySignals : [],
      actionRef: parsed.actionRef || 'hold',
      batchPlan: Array.isArray(parsed.batchPlan) ? parsed.batchPlan : [],
      confidence: typeof parsed.confidence === 'number'
        ? Math.min(100, Math.max(0, Math.round(parsed.confidence)))
        : 50,
      reasoning: parsed.reasoning || '',
      riskAlerts: Array.isArray(parsed.riskAlerts) ? parsed.riskAlerts : undefined,
    };
  } catch {
    return {
      stage: 'bottom',
      spaceEstimate: '',
      keySignals: [],
      actionRef: 'hold',
      batchPlan: [],
      confidence: 0,
      reasoning: raw,
    };
  }
}
