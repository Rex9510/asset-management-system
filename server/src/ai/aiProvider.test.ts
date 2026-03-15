import axios from 'axios';
import { DeepSeekProvider } from './deepSeekProvider';
import { ClaudeProvider } from './claudeProvider';
import { QwenProvider } from './qwenProvider';
import { getAIProvider, getSupportedProviders } from './aiProviderFactory';
import { AIProvider, AnalysisContext, ChatMessage } from './aiProvider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock database for factory tests
jest.mock('../db/connection', () => ({
  getDatabase: jest.fn(() => ({
    prepare: jest.fn(() => ({
      get: jest.fn(() => undefined),
    })),
  })),
}));

const TEST_API_KEY = 'test-api-key-12345';

const sampleContext: AnalysisContext = {
  stockCode: '600519',
  stockName: '贵州茅台',
  marketData: { price: 1800, changePercent: 2.5, volume: 10000 },
  technicalIndicators: {
    ma: { ma5: 1790, ma10: 1780, ma20: 1770, ma60: 1750 },
    macd: { dif: 5.2, dea: 3.1, histogram: 2.1 },
  },
};

const sampleAnalysisJSON = JSON.stringify({
  stage: 'rising',
  spaceEstimate: '10%-15%',
  keySignals: ['MACD金叉', '均线多头排列'],
  actionRef: 'hold',
  batchPlan: [{ action: 'sell', shares: 100, targetPrice: 2000, note: '目标价位' }],
  confidence: 75,
  reasoning: '技术面看多，参考方案为持有',
});

describe('DeepSeekProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should throw if API key is missing', () => {
    const origKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    expect(() => new DeepSeekProvider('')).toThrow('DeepSeek API key 未配置');
    process.env.DEEPSEEK_API_KEY = origKey;
  });

  it('should return correct model name', () => {
    const provider = new DeepSeekProvider(TEST_API_KEY);
    expect(provider.getModelName()).toBe('deepseek-chat');
  });

  it('should return custom model name', () => {
    const provider = new DeepSeekProvider(TEST_API_KEY, 'deepseek-coder');
    expect(provider.getModelName()).toBe('deepseek-coder');
  });

  it('should call analyze and parse result', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { choices: [{ message: { content: sampleAnalysisJSON } }] },
    });
    const provider = new DeepSeekProvider(TEST_API_KEY);
    const result = await provider.analyze(sampleContext);
    expect(result.stage).toBe('rising');
    expect(result.actionRef).toBe('hold');
    expect(result.confidence).toBe(75);
    expect(result.keySignals).toContain('MACD金叉');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({ model: 'deepseek-chat' }),
      expect.objectContaining({ timeout: 30000 })
    );
  });

  it('should call chat and return response', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { choices: [{ message: { content: '这是一个参考方案回复' } }] },
    });
    const provider = new DeepSeekProvider(TEST_API_KEY);
    const messages: ChatMessage[] = [{ role: 'user', content: '分析一下茅台' }];
    const result = await provider.chat(messages, '你是投资助手');
    expect(result).toBe('这是一个参考方案回复');
  });

  it('should handle rate limit error', async () => {
    mockedAxios.post.mockRejectedValueOnce({ response: { status: 429 }, message: 'rate limited' });
    const provider = new DeepSeekProvider(TEST_API_KEY);
    await expect(provider.chat([{ role: 'user', content: 'test' }])).rejects.toThrow('AI 服务请求过于频繁');
  });

  it('should handle generic API error', async () => {
    mockedAxios.post.mockRejectedValueOnce({ message: 'network error' });
    const provider = new DeepSeekProvider(TEST_API_KEY);
    await expect(provider.chat([{ role: 'user', content: 'test' }])).rejects.toThrow('DeepSeek API 调用失败');
  });

  it('should handle malformed analysis response gracefully', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'not valid json' } }] },
    });
    const provider = new DeepSeekProvider(TEST_API_KEY);
    const result = await provider.analyze(sampleContext);
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toBe('not valid json');
  });
});

describe('ClaudeProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should throw if API key is missing', () => {
    const origKey = process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    expect(() => new ClaudeProvider('')).toThrow('Claude API key 未配置');
    process.env.CLAUDE_API_KEY = origKey;
  });

  it('should return correct model name', () => {
    const provider = new ClaudeProvider(TEST_API_KEY);
    expect(provider.getModelName()).toBe('claude-3-haiku-20240307');
  });

  it('should call analyze and parse result', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { content: [{ text: sampleAnalysisJSON }] },
    });
    const provider = new ClaudeProvider(TEST_API_KEY);
    const result = await provider.analyze(sampleContext);
    expect(result.stage).toBe('rising');
    expect(result.confidence).toBe(75);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ model: 'claude-3-haiku-20240307' }),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': TEST_API_KEY }),
      })
    );
  });

  it('should call chat and return response', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { content: [{ text: '参考方案回复' }] },
    });
    const provider = new ClaudeProvider(TEST_API_KEY);
    const result = await provider.chat([{ role: 'user', content: '分析茅台' }]);
    expect(result).toBe('参考方案回复');
  });

  it('should handle rate limit error', async () => {
    mockedAxios.post.mockRejectedValueOnce({ response: { status: 429 }, message: 'rate limited' });
    const provider = new ClaudeProvider(TEST_API_KEY);
    await expect(provider.chat([{ role: 'user', content: 'test' }])).rejects.toThrow('AI 服务请求过于频繁');
  });
});

describe('QwenProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should throw if API key is missing', () => {
    const origKey = process.env.QWEN_API_KEY;
    delete process.env.QWEN_API_KEY;
    expect(() => new QwenProvider('')).toThrow('Qwen API key 未配置');
    process.env.QWEN_API_KEY = origKey;
  });

  it('should return correct model name', () => {
    const provider = new QwenProvider(TEST_API_KEY);
    expect(provider.getModelName()).toBe('qwen-turbo');
  });

  it('should call analyze and parse result', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { output: { text: sampleAnalysisJSON } },
    });
    const provider = new QwenProvider(TEST_API_KEY);
    const result = await provider.analyze(sampleContext);
    expect(result.stage).toBe('rising');
    expect(result.confidence).toBe(75);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      expect.objectContaining({ model: 'qwen-turbo' }),
      expect.any(Object)
    );
  });

  it('should call chat and return response', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { output: { text: '通义千问参考方案回复' } },
    });
    const provider = new QwenProvider(TEST_API_KEY);
    const result = await provider.chat([{ role: 'user', content: '分析茅台' }]);
    expect(result).toBe('通义千问参考方案回复');
  });

  it('should handle rate limit error', async () => {
    mockedAxios.post.mockRejectedValueOnce({ response: { status: 429 }, message: 'rate limited' });
    const provider = new QwenProvider(TEST_API_KEY);
    await expect(provider.chat([{ role: 'user', content: 'test' }])).rejects.toThrow('AI 服务请求过于频繁');
  });
});

describe('AIProviderFactory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should create DeepSeekProvider by default', () => {
    process.env.DEEPSEEK_API_KEY = TEST_API_KEY;
    const provider = getAIProvider();
    expect(provider.getModelName()).toBe('deepseek-chat');
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('should create DeepSeekProvider when specified', () => {
    process.env.DEEPSEEK_API_KEY = TEST_API_KEY;
    const provider = getAIProvider('deepseek');
    expect(provider.getModelName()).toBe('deepseek-chat');
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('should create ClaudeProvider when specified', () => {
    process.env.CLAUDE_API_KEY = TEST_API_KEY;
    const provider = getAIProvider('claude');
    expect(provider.getModelName()).toBe('claude-3-haiku-20240307');
    delete process.env.CLAUDE_API_KEY;
  });

  it('should create QwenProvider when specified', () => {
    process.env.QWEN_API_KEY = TEST_API_KEY;
    const provider = getAIProvider('qwen');
    expect(provider.getModelName()).toBe('qwen-turbo');
    delete process.env.QWEN_API_KEY;
  });

  it('should throw for unsupported provider', () => {
    expect(() => getAIProvider('gpt4')).toThrow('不支持的 AI 提供者');
  });

  it('should be case-insensitive for provider name', () => {
    process.env.DEEPSEEK_API_KEY = TEST_API_KEY;
    const provider = getAIProvider('DeepSeek');
    expect(provider.getModelName()).toBe('deepseek-chat');
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('should return supported providers list', () => {
    const providers = getSupportedProviders();
    expect(providers).toEqual(['deepseek', 'claude', 'qwen']);
  });

  it('all providers implement AIProvider interface', () => {
    const providers: { name: string; create: () => AIProvider }[] = [
      { name: 'deepseek', create: () => new DeepSeekProvider(TEST_API_KEY) },
      { name: 'claude', create: () => new ClaudeProvider(TEST_API_KEY) },
      { name: 'qwen', create: () => new QwenProvider(TEST_API_KEY) },
    ];
    for (const { name, create } of providers) {
      const provider = create();
      expect(typeof provider.analyze).toBe('function');
      expect(typeof provider.chat).toBe('function');
      expect(typeof provider.getModelName).toBe('function');
      expect(typeof provider.getModelName()).toBe('string');
    }
  });

  it('should read provider from ai_config table when no name provided', () => {
    const { getDatabase } = require('../db/connection');
    (getDatabase as jest.Mock).mockReturnValueOnce({
      prepare: jest.fn(() => ({
        get: jest.fn(() => ({ value: 'claude' })),
      })),
    });
    process.env.CLAUDE_API_KEY = TEST_API_KEY;
    const provider = getAIProvider();
    expect(provider.getModelName()).toBe('claude-3-haiku-20240307');
    delete process.env.CLAUDE_API_KEY;
  });
});
