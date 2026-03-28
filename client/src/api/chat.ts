import apiClient from './client';

export interface ChatMessage {
  id: number;
  userId: number;
  role: 'user' | 'assistant';
  content: string;
  stockCode: string | null;
  createdAt: string;
}

export interface SendMessageResponse {
  message: ChatMessage;
  sellIntentDetected: boolean;
}

export interface CalmDownEvaluation {
  buyLogicReview: string;
  sellJudgment: 'rational' | 'emotional';
  worstCaseEstimate: string;
  recommendation: string;
}

export async function sendMessage(content: string, stockCode?: string): Promise<SendMessageResponse> {
  const res = await apiClient.post<SendMessageResponse>('/chat/send', { content, stockCode });
  return res.data;
}

export async function getChatHistory(limit: number = 50): Promise<ChatMessage[]> {
  const res = await apiClient.get<{ messages: ChatMessage[] }>('/chat/history', {
    params: { limit },
  });
  return res.data.messages;
}

export async function evaluateCalmDown(stockCode: string): Promise<CalmDownEvaluation> {
  const res = await apiClient.post<{ evaluation: CalmDownEvaluation }>('/calm-down/evaluate', { stockCode });
  return res.data.evaluation;
}
