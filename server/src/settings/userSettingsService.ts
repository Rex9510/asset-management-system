import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { Errors } from '../errors/AppError';

// --- Types ---

export interface UserSettings {
  userId: number;
  aiModel: string;
  analysisFrequency: number;
  riskPreference: string;
  updatedAt: string;
}

export interface UpdateSettingsInput {
  aiModel?: string;
  analysisFrequency?: number;
  riskPreference?: string;
}

// --- Constants ---

const VALID_AI_MODELS = ['deepseek-v3', 'deepseek-r1', 'claude', 'qwen'];
const VALID_FREQUENCIES = [30, 60, 120];
const VALID_RISK_PREFERENCES = ['conservative', 'balanced', 'aggressive'];

const DEFAULT_SETTINGS: Omit<UserSettings, 'userId' | 'updatedAt'> = {
  aiModel: 'deepseek-v3',
  analysisFrequency: 60,
  riskPreference: 'balanced',
};

// --- Service functions ---

export function getUserSettings(
  userId: number,
  db?: Database.Database
): UserSettings {
  const database = db || getDatabase();

  const row = database.prepare(
    'SELECT user_id, ai_model, analysis_frequency, risk_preference, updated_at FROM user_settings WHERE user_id = ?'
  ).get(userId) as {
    user_id: number;
    ai_model: string;
    analysis_frequency: number;
    risk_preference: string;
    updated_at: string;
  } | undefined;

  if (!row) {
    return {
      userId,
      aiModel: DEFAULT_SETTINGS.aiModel,
      analysisFrequency: DEFAULT_SETTINGS.analysisFrequency,
      riskPreference: DEFAULT_SETTINGS.riskPreference,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    userId: row.user_id,
    aiModel: row.ai_model,
    analysisFrequency: row.analysis_frequency,
    riskPreference: row.risk_preference,
    updatedAt: row.updated_at,
  };
}

export function updateUserSettings(
  userId: number,
  input: UpdateSettingsInput,
  db?: Database.Database
): UserSettings {
  const database = db || getDatabase();

  // Validate input fields
  if (input.aiModel !== undefined && !VALID_AI_MODELS.includes(input.aiModel)) {
    throw Errors.badRequest(
      `无效的AI模型: ${input.aiModel}，可选值: ${VALID_AI_MODELS.join(', ')}`
    );
  }

  if (input.analysisFrequency !== undefined && !VALID_FREQUENCIES.includes(input.analysisFrequency)) {
    throw Errors.badRequest(
      `无效的分析频率: ${input.analysisFrequency}，可选值: ${VALID_FREQUENCIES.join(', ')} 分钟`
    );
  }

  if (input.riskPreference !== undefined && !VALID_RISK_PREFERENCES.includes(input.riskPreference)) {
    throw Errors.badRequest(
      `无效的风险偏好: ${input.riskPreference}，可选值: ${VALID_RISK_PREFERENCES.join(', ')}`
    );
  }

  // Get current settings to merge with partial update
  const current = getUserSettings(userId, database);

  const aiModel = input.aiModel ?? current.aiModel;
  const analysisFrequency = input.analysisFrequency ?? current.analysisFrequency;
  const riskPreference = input.riskPreference ?? current.riskPreference;

  database.prepare(`
    INSERT OR REPLACE INTO user_settings (user_id, ai_model, analysis_frequency, risk_preference, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(userId, aiModel, analysisFrequency, riskPreference);

  return getUserSettings(userId, database);
}
