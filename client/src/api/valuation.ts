import apiClient from './client';

export interface ValuationData {
  stockCode: string;
  peValue: number | null;
  pbValue: number | null;
  pePercentile: number;
  pbPercentile: number;
  peZone: 'low' | 'fair' | 'high';
  pbZone: 'low' | 'fair' | 'high';
  dataYears: number;
  source: string;
  updatedAt: string;
}

export async function getValuation(stockCode: string): Promise<ValuationData> {
  const res = await apiClient.get<ValuationData>(`/valuation/${stockCode}`);
  return res.data;
}
