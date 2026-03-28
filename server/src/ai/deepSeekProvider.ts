/**
 * DeepSeek AI Provider 实现
 * 使用 DeepSeek API (https://api.deepseek.com/v1/chat/completions)
 * 默认模型: deepseek-chat
 */
import axios from 'axios';
import { AIProvider, AnalysisContext, AnalysisResult, ChatMessage } from './aiProvider';
import { buildAnalysisSystemPrompt, buildAnalysisUserPrompt, parseAnalysisResult } from './aiUtils';
import { AppError } from '../errors/AppError';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1/chat/completions';
const TIMEOUT_MS = 30000;

export class DeepSeekProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.DEEPSEEK_API_KEY || '';
    this.model = model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    if (!this.apiKey) {
      throw new AppError(500, 'AI_CONFIG_ERROR', 'DeepSeek API key 未配置');
    }
  }

  getModelName(): string {
    return this.model;
  }

  async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const systemPrompt = buildAnalysisSystemPrompt();
    const userPrompt = buildAnalysisUserPrompt(context);
    const response = await this.callAPI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
    return parseAnalysisResult(response);
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

}
