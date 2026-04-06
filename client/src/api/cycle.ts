import apiClient from './client';

export interface CycleMonitorData {
  id: number;
  stockCode: string;
  stockName: string;
  cycleLength: string | null;
  currentPhase: string | null;
  status: 'bottom' | 'falling' | 'rising' | 'high';
  description: string | null;
  bottomSignals: string[];
  updatedAt: string;
  currentMonths: number | null;
  cycleLengthMonths: number | null;
  currentPrice: number | null;
  changePercent: number | null;
}

export async function getCycleMonitors(): Promise<CycleMonitorData[]> {
  const res = await apiClient.get<{ monitors: CycleMonitorData[] }>('/cycle/monitors');
  return res.data.monitors;
}

export async function addCycleMonitor(stockCode: string): Promise<CycleMonitorData> {
  const res = await apiClient.post<CycleMonitorData>('/cycle/monitors', { stockCode });
  return res.data;
}

export async function deleteCycleMonitor(id: number): Promise<void> {
  await apiClient.delete(`/cycle/monitors/${id}`);
}
