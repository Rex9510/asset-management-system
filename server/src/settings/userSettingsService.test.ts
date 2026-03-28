import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import {
  getUserSettings,
  updateUserSettings,
  UserSettings,
} from './userSettingsService';

let testDb: Database.Database;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function insertUser(db: Database.Database, userId: number): void {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(userId, `user${userId}`, 'hash');
}

beforeEach(() => {
  testDb = makeDb();
  insertUser(testDb, 1);
});

afterEach(() => {
  testDb.close();
});

// --- getUserSettings ---

describe('getUserSettings', () => {
  it('should return defaults when no settings exist', () => {
    const settings = getUserSettings(1, testDb);
    expect(settings.userId).toBe(1);
    expect(settings.aiModel).toBe('deepseek-v3');
    expect(settings.analysisFrequency).toBe(60);
    expect(settings.riskPreference).toBe('balanced');
    expect(settings.updatedAt).toBeDefined();
  });

  it('should return saved settings when they exist', () => {
    testDb.prepare(
      "INSERT INTO user_settings (user_id, ai_model, analysis_frequency, risk_preference) VALUES (?, ?, ?, ?)"
    ).run(1, 'claude', 30, 'aggressive');

    const settings = getUserSettings(1, testDb);
    expect(settings.aiModel).toBe('claude');
    expect(settings.analysisFrequency).toBe(30);
    expect(settings.riskPreference).toBe('aggressive');
  });
});

// --- updateUserSettings ---

describe('updateUserSettings', () => {
  it('should create settings for a new user', () => {
    const result = updateUserSettings(1, {
      aiModel: 'claude',
      analysisFrequency: 120,
      riskPreference: 'conservative',
    }, testDb);

    expect(result.userId).toBe(1);
    expect(result.aiModel).toBe('claude');
    expect(result.analysisFrequency).toBe(120);
    expect(result.riskPreference).toBe('conservative');
  });

  it('should update existing settings', () => {
    updateUserSettings(1, { aiModel: 'claude' }, testDb);
    const updated = updateUserSettings(1, { aiModel: 'qwen' }, testDb);
    expect(updated.aiModel).toBe('qwen');
  });

  it('should reject invalid ai_model', () => {
    expect(() => {
      updateUserSettings(1, { aiModel: 'gpt-4' }, testDb);
    }).toThrow('无效的AI模型');
  });

  it('should reject invalid analysis_frequency', () => {
    expect(() => {
      updateUserSettings(1, { analysisFrequency: 45 }, testDb);
    }).toThrow('无效的分析频率');
  });

  it('should reject invalid risk_preference', () => {
    expect(() => {
      updateUserSettings(1, { riskPreference: 'yolo' }, testDb);
    }).toThrow('无效的风险偏好');
  });

  it('should support partial update - only aiModel', () => {
    updateUserSettings(1, {
      aiModel: 'claude',
      analysisFrequency: 120,
      riskPreference: 'aggressive',
    }, testDb);

    const result = updateUserSettings(1, { aiModel: 'qwen' }, testDb);
    expect(result.aiModel).toBe('qwen');
    expect(result.analysisFrequency).toBe(120);
    expect(result.riskPreference).toBe('aggressive');
  });

  it('should support partial update - only analysisFrequency', () => {
    updateUserSettings(1, {
      aiModel: 'deepseek-r1',
      analysisFrequency: 30,
      riskPreference: 'conservative',
    }, testDb);

    const result = updateUserSettings(1, { analysisFrequency: 120 }, testDb);
    expect(result.aiModel).toBe('deepseek-r1');
    expect(result.analysisFrequency).toBe(120);
    expect(result.riskPreference).toBe('conservative');
  });

  it('should support partial update - only riskPreference', () => {
    updateUserSettings(1, {
      aiModel: 'deepseek-v3',
      analysisFrequency: 60,
      riskPreference: 'balanced',
    }, testDb);

    const result = updateUserSettings(1, { riskPreference: 'aggressive' }, testDb);
    expect(result.aiModel).toBe('deepseek-v3');
    expect(result.analysisFrequency).toBe(60);
    expect(result.riskPreference).toBe('aggressive');
  });
});
