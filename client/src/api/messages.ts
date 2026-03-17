import apiClient from './client';

export async function getUnreadCount(): Promise<number> {
  const res = await apiClient.get<{ count: number }>('/messages/unread-count');
  return res.data.count;
}
