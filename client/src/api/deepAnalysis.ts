import apiClient from './client';

export interface DeepReport {
  id: number;
  userId: number;
  stockCode: string;
  stockName: string;
  conclusion: string;
  fundamentals: string;
  financials: string;
  valuation: string;
  strategy: string;
  aiModel: string;
  confidence: number | null;
  dataCutoffDate: string;
  status: 'generating' | 'completed' | 'failed';
  createdAt: string;
}

export async function startDeepReport(stockCode: string): Promise<{ reportId: number; status: string }> {
  const res = await apiClient.post(`/analysis/deep/${stockCode}`);
  return res.data;
}

export async function getDeepReport(reportId: number): Promise<DeepReport> {
  const res = await apiClient.get(`/analysis/deep/${reportId}`);
  return res.data;
}
