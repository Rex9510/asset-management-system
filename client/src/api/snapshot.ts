import apiClient from './client';

export interface ProfitCurvePoint {
  date: string;
  totalValue: number;
  totalProfit: number;
}

export interface SectorDistItem {
  sector: string;
  value: number;
  percentage: number;
}

export interface StockPnlItem {
  stockCode: string;
  stockName: string;
  profitLoss: number;
  marketValue: number;
}

export interface ChartData {
  profitCurve: ProfitCurvePoint[];
  sectorDistribution: SectorDistItem[];
  stockPnl: StockPnlItem[];
}

export async function getChartData(period: string = '30d'): Promise<ChartData> {
  const res = await apiClient.get('/snapshot/chart-data', { params: { period } });
  return res.data;
}
