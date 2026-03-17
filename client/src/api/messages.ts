import apiClient from './client';

export async function getUnreadCount(): Promise<number> {
  const res = await apiClient.get<{ count: number }>('/messages/unread-count');
  return res.data.count;
}

export interface DailyPickMessage {
  id: number;
  stockCode: string;
  stockName: string;
  summary: string;
  detail: string;
  createdAt: string;
}

export async function getDailyPicks(): Promise<DailyPickMessage[]> {
  const res = await apiClient.get<{ messages: DailyPickMessage[] }>('/messages', {
    params: { type: 'daily_pick', limit: 3 }
  });
  return res.data.messages;
}
