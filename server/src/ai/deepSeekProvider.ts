/**
 * DeepSeek AI Provider 实现
 * 使用 DeepSeek API (https://api.deepseek.com/v1/chat/completions)
 * 默认模型: deepseek-chat
 */
import axios from 'axios';
import { AIProvider, AnalysisContext, AnalysisResult, ChatMessage } from './aiProvider';
import { AppError } from '../errors/AppError';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1/chat/completions';
const TIMEOUT_MS = 30000;

export class DeepSeekProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.DEEPSEEK_API_KEY || '';
    this.model = model || 'deepseek-chat';
    if (!this.apiKey) {
      throw new AppError(500, 'AI_CONFIG_ERROR', 'DeepSeek API key 未配置');
    }
  }

  getModelName(): string {
    return this.model;
  }

  async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const systemPrompt = this.buildAnalysisSystemPrompt();
    const userPrompt = this.buildAnalysisUserPrompt(context);
    const response = await this.callAPI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
    return this.parseAnalysisResult(response);
  }

  async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    const apiMessages: ChatMessage[] = [];
    if (systemPrompt) {
      apiMessages.push({ role: 'system', content: systemPrompt });
    }
    apiMessages.push(...messages);
    return this.callAPI(apiMessages);
  }

  private async callAPI(messages: ChatMessage[]): Promise<string> {
    try {
      const response = await axios.post(
        DEEPSEEK_BASE_URL,
        {
          model: this.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: 0.7,
          max_tokens: 4096,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: TIMEOUT_MS,
        }
      );
      return response.data.choices?.[0]?.message?.content || '';
    } catch (error: any) {
      if (error.response?.status === 429) {
        throw new AppError(429, 'AI_RATE_LIMIT', 'AI 服务请求过于频繁，请稍后重试');
      }
      throw new AppError(502, 'AI_SERVICE_ERROR', `DeepSeek API 调用失败: ${error.message}`);
    }
  }

  private buildAnalysisSystemPrompt(): string {
    return `你是一个专业的A股投资分析助手。请基于提供的行情数据、技术指标和新闻信息进行分析。
要求：
1. 使用"参考方案"措辞，禁止使用"建议""推荐"等投资顾问措辞
2. 返回严格的 JSON 格式
3. stage 取值: bottom, rising, main_wave, high, falling
4. actionRef 取值: hold, add, reduce, clear
5. confidence 取值: 0-100 整数`;
  }

  private buildAnalysisUserPrompt(context: AnalysisContext): string {
    return JSON.stringify({
      stockCode: context.stockCode,
      stockName: context.stockName,
      marketData: context.marketData,
      technicalIndicators: context.technicalIndicators,
      newsItems: context.newsItems || [],
      positionData: context.positionData || null,
    });
  }

  private parseAnalysisResult(raw: string): AnalysisResult {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      return {
        stage: parsed.stage || 'bottom',
        spaceEstimate: parsed.spaceEstimate || '',
        keySignals: Array.isArray(parsed.keySignals) ? parsed.keySignals : [],
        actionRef: parsed.actionRef || 'hold',
        batchPlan: Array.isArray(parsed.batchPlan) ? parsed.batchPlan : [],
        confidence: typeof parsed.confidence === 'number' ? Math.min(100, Math.max(0, Math.round(parsed.confidence))) : 50,
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
}
