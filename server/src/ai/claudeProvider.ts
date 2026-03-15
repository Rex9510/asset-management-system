/**
 * Claude AI Provider 实现
 * 使用 Anthropic API (https://api.anthropic.com/v1/messages)
 * 默认模型: claude-3-haiku-20240307
 */
import axios from 'axios';
import { AIProvider, AnalysisContext, AnalysisResult, ChatMessage } from './aiProvider';
import { AppError } from '../errors/AppError';

const CLAUDE_BASE_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 30000;

export class ClaudeProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.CLAUDE_API_KEY || '';
    this.model = model || 'claude-3-haiku-20240307';
    if (!this.apiKey) {
      throw new AppError(500, 'AI_CONFIG_ERROR', 'Claude API key 未配置');
    }
  }

  getModelName(): string {
    return this.model;
  }

  async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const systemPrompt = this.buildAnalysisSystemPrompt();
    const userPrompt = this.buildAnalysisUserPrompt(context);
    const response = await this.callAPI(
      [{ role: 'user', content: userPrompt }],
      systemPrompt
    );
    return this.parseAnalysisResult(response);
  }

  async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    const apiMessages = messages.filter((m) => m.role !== 'system');
    const system = systemPrompt || messages.find((m) => m.role === 'system')?.content;
    return this.callAPI(apiMessages, system);
  }

  private async callAPI(messages: ChatMessage[], system?: string): Promise<string> {
    try {
      const body: Record<string, unknown> = {
        model: this.model,
        max_tokens: 4096,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      };
      if (system) {
        body.system = system;
      }
      const response = await axios.post(CLAUDE_BASE_URL, body, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: TIMEOUT_MS,
      });
      const content = response.data.content;
      if (Array.isArray(content) && content.length > 0) {
        return content.map((block: { text?: string }) => block.text || '').join('');
      }
      return '';
    } catch (error: any) {
      if (error.response?.status === 429) {
        throw new AppError(429, 'AI_RATE_LIMIT', 'AI 服务请求过于频繁，请稍后重试');
      }
      throw new AppError(502, 'AI_SERVICE_ERROR', `Claude API 调用失败: ${error.message}`);
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
