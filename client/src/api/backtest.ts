import apiClient from './client';

export interface BacktestPeriodResult {
  period: '30d' | '90d' | '180d' | '365d';
  winRate: number;
  avgReturn: number;
  maxReturn: number;
  maxLoss: number;
  medianReturn: number;
}

export interface BacktestResult {
  stockCode: string;
  currentPercentile: number;
  matchingPoints: number;
  results: BacktestPeriodResult[];
  sampleWarning: boolean;
  summary: string;
  disclaimer: string;
}

export async function runBacktest(stockCode: string): Promise<BacktestResult> {
  const res = await apiClient.post(`/backtest/${stockCode}`);
  return res.data;
}
