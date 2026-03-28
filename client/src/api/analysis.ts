import apiClient from './client';

// --- Analysis Types ---

export interface BatchStep {
  action: string;
  shares: number;
  targetPrice: number;
  note: string;
}

export interface PositionStrategy {
  profitPosition: { percent: number; action: string };
  basePosition: { percent: number; action: string };
}

export interface AnalysisData {
  id: number;
  userId: number;
  stockCode: string;
  stockName: string;
  triggerType: string;
  stage: string;
  spaceEstimate: string;
  keySignals: string[];
  actionRef: string;
  batchPlan: BatchStep[];
  confidence: number;
  reasoning: string;
  dataSources: string[];
  technicalIndicators: Record<string, unknown> | null;
  newsSummary: string[];
  recoveryEstimate: string | null;
  profitEstimate: string | null;
  riskAlerts: string[];
  targetPrice?: { low: number; high: number };
  positionStrategy?: PositionStrategy;
  createdAt: string;
}

// --- Indicator Types ---

export type SignalDirection = 'bullish' | 'neutral' | 'bearish';

export interface Signal {
  direction: SignalDirection;
  label: string;
}

export interface IndicatorData {
  stockCode: string;
  tradeDate: string;
  ma: { ma5: number | null; ma10: number | null; ma20: number | null; ma60: number | null };
  macd: { dif: number | null; dea: number | null; histogram: number | null };
  kdj: { k: number | null; d: number | null; j: number | null };
  rsi: { rsi6: number | null; rsi12: number | null; rsi24: number | null };
  signals: {
    ma: Signal;
    macd: Signal;
    kdj: Signal;
    rsi: Signal;
  };
  updatedAt: string;
}

export interface RiskAlert {
  type: string;
  level: string;
  label: string;
  explanation: string;
}

// --- API Functions ---

export async function getAnalysis(stockCode: string): Promise<AnalysisData | null> {
  const res = await apiClient.get<{ analyses: AnalysisData[] }>(`/analysis/${stockCode}`, {
    params: { limit: 1 },
  });
  const analyses = res.data.analyses;
  return analyses.length > 0 ? analyses[0] : null;
}

export async function triggerAnalysis(stockCode: string): Promise<AnalysisData> {
  const res = await apiClient.post<{ analysis: AnalysisData }>('/analysis/trigger', { stockCode });
  return res.data.analysis;
}

export async function getIndicators(stockCode: string): Promise<IndicatorData> {
  const res = await apiClient.get<IndicatorData>(`/indicators/${stockCode}`);
  return res.data;
}

export async function getRiskAlerts(stockCode: string): Promise<RiskAlert[]> {
  const res = await apiClient.get<{ stockCode: string; alerts: RiskAlert[] }>(`/indicators/${stockCode}/risks`);
  return res.data.alerts;
}

export async function getAnalysisHistory(stockCode: string, limit: number = 10): Promise<AnalysisData[]> {
  const res = await apiClient.get<{ analyses: AnalysisData[] }>(`/analysis/${stockCode}`, {
    params: { limit },
  });
  return res.data.analyses;
}
