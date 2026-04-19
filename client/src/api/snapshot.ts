import apiClient from './client';

export interface ProfitCurvePoint {
  date: string;
  totalValue: number;
  totalProfit: number;
  totalCost: number;
  /** 相对总成本的收益率（%），用于汇总 */
  returnOnCostPct: number;
  /** 较上一快照日市值涨跌（%），区间首日为 null */
  dayMvChangePct: number | null;
  /** 较上一快照日浮动盈亏增减（元），区间首日为 null */
  dayProfitDelta: number | null;
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

export interface ProfitCurveMeta {
  hasCalendarGaps: boolean;
}

export interface ChartData {
  profitCurve: ProfitCurvePoint[];
  sectorDistribution: SectorDistItem[];
  stockPnl: StockPnlItem[];
  profitCurveMeta?: ProfitCurveMeta;
}

/** 7d / 30d / 90d / 365d（日历视图用近一年快照） */
export async function getChartData(period: string = '30d'): Promise<ChartData> {
  const res = await apiClient.get('/snapshot/chart-data', { params: { period } });
  return res.data;
}
