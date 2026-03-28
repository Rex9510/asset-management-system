import apiClient from './client';

export interface UserSettings {
  aiModel: string;
  analysisFrequency: number;
  riskPreference: 'conservative' | 'balanced' | 'aggressive';
}

export async function getSettings(): Promise<UserSettings> {
  const res = await apiClient.get('/settings');
  return res.data;
}

export async function updateSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const res = await apiClient.put('/settings', settings);
  return res.data;
}
