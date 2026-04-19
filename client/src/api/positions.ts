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
  changePercent: number | null;
  holdingDays: number | null;
  stopLossPrice?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePositionData {
  stockCode: string;
  stockName: string;
  positionType: 'holding' | 'watching';
  costPrice?: number;
  shares?: number;
  buyDate?: string;
}

export interface UpdatePositionData {
  costPrice?: number;
  shares?: number;
  buyDate?: string;
}

export interface StockCandidate {
  stockCode: string;
  stockName: string;
}

export async function getPositions(type?: 'holding' | 'watching'): Promise<Position[]> {
  const params = type ? { type } : {};
  const res = await apiClient.get<{ positions: Position[] }>('/positions', { params });
  return res.data.positions;
}

export async function createPosition(data: CreatePositionData): Promise<Position> {
  const res = await apiClient.post<{ position: Position }>('/positions', data);
  return res.data.position;
}

export async function updatePosition(id: number, data: UpdatePositionData): Promise<Position> {
  const res = await apiClient.put<{ position: Position }>(`/positions/${id}`, data);
  return res.data.position;
}

export async function deletePosition(id: number): Promise<void> {
  await apiClient.delete(`/positions/${id}`);
}


export async function getTodayPnl(): Promise<number> {
  const res = await apiClient.get<{ todayPnl: number }>('/positions/today-pnl');
  return res.data.todayPnl;
}

export async function searchStockCandidates(keyword: string): Promise<StockCandidate[]> {
  const res = await apiClient.get<{ candidates: StockCandidate[] }>('/positions/search', {
    params: { keyword },
  });
  return res.data.candidates;
}
