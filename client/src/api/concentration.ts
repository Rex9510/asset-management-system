import apiClient from './client';

export interface SectorAllocation {
  sector: string;
  stockCount: number;
  totalValue: number;
  percentage: number;
}

export interface ConcentrationData {
  sectors: SectorAllocation[];
  totalValue: number;
  riskWarning: string | null;
}

export async function getConcentration(): Promise<ConcentrationData> {
  const res = await apiClient.get('/concentration');
  return res.data;
}
