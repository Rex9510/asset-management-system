import apiClient from './client';

export interface MessageResponse {
  id: number;
  userId: number;
  type: string;
  stockCode: string;
  stockName: string;
  summary: string;
  detail: string;
  analysisId: number | null;
  isRead: boolean;
  createdAt: string;
}

export interface GetMessagesResult {
  messages: MessageResponse[];
  total: number;
  hasMore: boolean;
}

export interface GetMessagesOptions {
  type?: string;
  page?: number;
  limit?: number;
}

export async function getMessages(options: GetMessagesOptions = {}): Promise<GetMessagesResult> {
  const params: Record<string, string | number> = {};
  if (options.type) params.type = options.type;
  if (options.page) params.page = options.page;
  if (options.limit) params.limit = options.limit;
  const res = await apiClient.get<GetMessagesResult>('/messages', { params });
  return res.data;
}

export async function getMessageDetail(id: number): Promise<MessageResponse> {
  const res = await apiClient.get<{ message: MessageResponse }>(`/messages/${id}`);
  return res.data.message;
}

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
