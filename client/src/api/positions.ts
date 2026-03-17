import apiClient from './client';

export interface Position {
  id: number;
  userId: number;
  stockCode: string;
  stockName: string;
  positionType: 'holding' | 'watching';
  costPrice: number | null;
  shares: number | null;
  buyDate: string | null;
  currentPrice: number | null;
  profitLoss: number | null;
  profitLossPercent: number | null;
  holdingDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export async function getPositions(type?: 'holding' | 'watching'): Promise<Position[]> {
  const params = type ? { type } : {};
  const res = await apiClient.get<{ positions: Position[] }>('/positions', { params });
  return res.data.positions;
}
