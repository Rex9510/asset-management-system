import apiClient from './client';

export interface MarketEnvData {
  environment: 'bull' | 'sideways' | 'bear';
  label: string;
  confidenceAdjust: number;
  riskTip: string | null;
  indicators: {
    shIndex: { ma20Trend: string; ma60Trend: string };
    hs300: { ma20Trend: string; ma60Trend: string };
    volumeChange: number;
    advanceDeclineRatio: number;
  };
  updatedAt: string;
}

export async function getMarketEnv(): Promise<MarketEnvData> {
  const res = await apiClient.get<MarketEnvData>('/market-env/current');
  return res.data;
}
