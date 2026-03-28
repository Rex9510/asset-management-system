import apiClient from './client';

export interface ChainNode {
  symbol: string;
  name: string;
  shortName: string;
  status: 'activated' | 'transmitting' | 'inactive';
  change10d: number;
  label: string;
}

export interface ChainStatusData {
  nodes: ChainNode[];
  updatedAt: string;
}

export async function getChainStatus(): Promise<ChainStatusData> {
  const res = await apiClient.get<ChainStatusData>('/chain/status');
  return res.data;
}
