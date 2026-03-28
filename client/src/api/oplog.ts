import apiClient from './client';

export interface OperationLog {
  id: number;
  operationType: string;
  stockCode: string;
  stockName: string;
  price: number | null;
  shares: number | null;
  aiSummary: string | null;
  review7d: string | null;
  review7dAt: string | null;
  review30d: string | null;
  review30dAt: string | null;
  createdAt: string;
}

interface RawOperationLog {
  id: number;
  operation_type: string;
  stock_code: string;
  stock_name: string;
  price: number | null;
  shares: number | null;
  ai_summary: string | null;
  review_7d: string | null;
  review_7d_at: string | null;
  review_30d: string | null;
  review_30d_at: string | null;
  created_at: string;
}

function mapLog(raw: RawOperationLog): OperationLog {
  return {
    id: raw.id,
    operationType: raw.operation_type,
    stockCode: raw.stock_code,
    stockName: raw.stock_name,
    price: raw.price,
    shares: raw.shares,
    aiSummary: raw.ai_summary,
    review7d: raw.review_7d,
    review7dAt: raw.review_7d_at,
    review30d: raw.review_30d,
    review30dAt: raw.review_30d_at,
    createdAt: raw.created_at,
  };
}

export async function getOperationLogs(page = 1, limit = 20): Promise<{ logs: OperationLog[]; total: number }> {
  const res = await apiClient.get('/oplog', { params: { page, limit } });
  return {
    logs: (res.data.logs || []).map(mapLog),
    total: res.data.total,
  };
}

export async function getReviews(): Promise<OperationLog[]> {
  const res = await apiClient.get('/oplog/review');
  return (res.data || []).map(mapLog);
}
