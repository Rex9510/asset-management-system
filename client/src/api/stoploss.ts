import apiClient from './client';

export interface StopLossAlert {
  positionId: number;
  stockCode: string;
  stockName: string;
  stopLossPrice: number;
  currentPrice: number;
  triggered: boolean;
}

export async function setStopLoss(positionId: number, stopLossPrice: number): Promise<void> {
  await apiClient.put(`/stoploss/set/${positionId}`, { stopLossPrice });
}

export async function checkStopLoss(): Promise<StopLossAlert[]> {
  const res = await apiClient.get<{ alerts: StopLossAlert[] }>('/stoploss/check');
  return res.data.alerts;
}
