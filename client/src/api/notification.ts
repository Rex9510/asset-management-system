import apiClient from './client';

export interface NotificationSetting {
  messageType: string;
  enabled: boolean;
  label: string;
}

export async function getNotificationSettings(): Promise<NotificationSetting[]> {
  const res = await apiClient.get('/notification/settings');
  return res.data;
}

export async function updateNotificationSettings(
  settings: { messageType: string; enabled: boolean }[]
): Promise<NotificationSetting[]> {
  const res = await apiClient.put('/notification/settings', { settings });
  return res.data;
}
