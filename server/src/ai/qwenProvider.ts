/**
 * 通义千问 (Qwen) AI Provider 实现
 * 使用 DashScope API (https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation)
 * 默认模型: qwen-turbo
 */
import axios from 'axios';
import { AIProvider, AnalysisContext, AnalysisResult, ChatMessage } from './aiProvider';
import { buildAnalysisSystemPrompt, buildAnalysisUserPrompt, parseAnalysisResult } from './aiUtils';
import { AppError } from '../errors/AppError';

const QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
const TIMEOUT_MS = 30000;

export class QwenProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.QWEN_API_KEY || '';
    this.model = model || 'qwen-turbo';
    if (!this.apiKey) {
      throw new AppError(500, 'AI_CONFIG_ERROR', 'Qwen API key 未配置');
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
        QWEN_BASE_URL,
        {
          model: this.model,
          input: {
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
          },
          parameters: {
            temperature: 0.7,
            max_tokens: 4096,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: TIMEOUT_MS,
        }
      );
      return response.data.output?.text || response.data.output?.choices?.[0]?.message?.content || '';
    } catch (error: any) {
      if (error.response?.status === 429) {
        throw new AppError(429, 'AI_RATE_LIMIT', 'AI 服务请求过于频繁，请稍后重试');
      }
      throw new AppError(502, 'AI_SERVICE_ERROR', `Qwen API 调用失败: ${error.message}`);
    }
  }

}
