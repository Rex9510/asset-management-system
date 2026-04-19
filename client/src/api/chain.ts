import apiClient from './client';

export interface ChainNode {
  symbol: string;
  name: string;
  shortName: string;
  status: 'activated' | 'transmitting' | 'inactive';
  /** 主窗口区间涨跌幅（%） */
  change10d: number;
  /** 约 6 个月辅窗口涨跌幅（%） */
  changeAux?: number;
  primaryWindowDays?: number;
  maxHistoryDays?: number;
  windowNote?: string;
  label: string;
}

export interface ChainStatusData {
  nodes: ChainNode[];
  updatedAt: string;
  methodSummary?: string;
}

export async function getChainStatus(): Promise<ChainStatusData> {
  const res = await apiClient.get<ChainStatusData>('/chain/status');
  return res.data;
}
