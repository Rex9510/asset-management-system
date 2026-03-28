/**
 * 用户设置属性测试
 * Task 22.2
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { getUserSettings, updateUserSettings } from './userSettingsService';
import { initializeDatabase } from '../db/init';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  initializeDatabase(db);
  db.prepare("INSERT INTO users (id, username, password_hash, last_login_at) VALUES (1, 'u1', 'h', datetime('now'))").run();
  return db;
}

const VALID_MODELS = ['deepseek-v3', 'deepseek-r1', 'claude', 'qwen'] as const;
const VALID_FREQUENCIES = [30, 60, 120] as const;
const VALID_RISK_PREFS = ['conservative', 'balanced', 'aggressive'] as const;

// Feature: ai-investment-assistant-phase2, Property 37: 用户设置往返
// 验证需求：16.2
test('保存设置后读取返回相同值', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...VALID_MODELS),
      fc.constantFrom(...VALID_FREQUENCIES),
      fc.constantFrom(...VALID_RISK_PREFS),
      (aiModel, analysisFrequency, riskPreference) => {
        const db = setupDb();

        updateUserSettings(1, { aiModel, analysisFrequency, riskPreference }, db);
        const settings = getUserSettings(1, db);

        expect(settings.aiModel).toBe(aiModel);
        expect(settings.analysisFrequency).toBe(analysisFrequency);
        expect(settings.riskPreference).toBe(riskPreference);

        db.close();
      }
    ),
    { numRuns: 36 }
  );
});

// Additional: default settings
test('未设置时返回默认值', () => {
  const db = setupDb();
  const settings = getUserSettings(1, db);

  expect(settings.aiModel).toBe('deepseek-v3');
  expect(settings.analysisFrequency).toBe(60);
  expect(settings.riskPreference).toBe('balanced');

  db.close();
});

// Additional: partial update preserves other fields
test('部分更新保留其他字段', () => {
  const db = setupDb();

  updateUserSettings(1, { aiModel: 'claude', analysisFrequency: 120, riskPreference: 'aggressive' }, db);
  updateUserSettings(1, { aiModel: 'qwen' }, db);

  const settings = getUserSettings(1, db);
  expect(settings.aiModel).toBe('qwen');
  expect(settings.analysisFrequency).toBe(120);
  expect(settings.riskPreference).toBe('aggressive');

  db.close();
});

// Additional: invalid model throws
test('无效AI模型抛出错误', () => {
  const db = setupDb();
  expect(() => updateUserSettings(1, { aiModel: 'invalid-model' }, db)).toThrow();
  db.close();
});
