/**
 * AI Provider 工厂
 * 根据配置创建对应的 AI Provider 实例
 * 支持从 ai_config 数据库表或环境变量读取配置
 * 切换模型仅需修改配置，无需修改业务代码
 */
import { AIProvider } from './aiProvider';
import { DeepSeekProvider } from './deepSeekProvider';
import { ClaudeProvider } from './claudeProvider';
import { QwenProvider } from './qwenProvider';
import { AppError } from '../errors/AppError';

export type ProviderName = 'deepseek' | 'claude' | 'qwen';

const SUPPORTED_PROVIDERS: ProviderName[] = ['deepseek', 'claude', 'qwen'];

/**
 * 根据 provider 名称创建 AIProvider 实例
 * @param providerName - 提供者名称，不传则从数据库 ai_config 表读取，默认 deepseek
 */
export function getAIProvider(providerName?: string): AIProvider {
  const name = resolveProviderName(providerName);
  return createProvider(name);
}

/**
 * 解析 provider 名称：优先使用传入值，否则从数据库读取，最终默认 deepseek
 */
function resolveProviderName(providerName?: string): ProviderName {
  if (providerName) {
    return validateProviderName(providerName);
  }

  // 尝试从数据库 ai_config 表读取
  try {
    const { getDatabase } = require('../db/connection');
    const db = getDatabase();
    const row = db.prepare('SELECT value FROM ai_config WHERE key = ?').get('provider') as
      | { value: string }
      | undefined;
    if (row?.value) {
      return validateProviderName(row.value);
    }
  } catch {
    // 数据库不可用时使用默认值
  }

  return 'deepseek';
}

function validateProviderName(name: string): ProviderName {
  const normalized = name.toLowerCase().trim() as ProviderName;
  if (!SUPPORTED_PROVIDERS.includes(normalized)) {
    throw new AppError(
      400,
      'INVALID_PROVIDER',
      `不支持的 AI 提供者: ${name}，支持的提供者: ${SUPPORTED_PROVIDERS.join(', ')}`
    );
  }
  return normalized;
}

function createProvider(name: ProviderName): AIProvider {
  switch (name) {
    case 'deepseek':
      return new DeepSeekProvider();
    case 'claude':
      return new ClaudeProvider();
    case 'qwen':
      return new QwenProvider();
    default:
      throw new AppError(400, 'INVALID_PROVIDER', `不支持的 AI 提供者: ${name}`);
  }
}

/** 获取支持的 provider 列表 */
export function getSupportedProviders(): ProviderName[] {
  return [...SUPPORTED_PROVIDERS];
}
