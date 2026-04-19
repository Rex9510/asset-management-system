import apiClient from './client';

/** 与 SSE / 服务端 getQuote 一致的结构 */
export interface MarketQuoteDTO {
  stockCode: string;
  stockName: string;
  price: number;
  changePercent: number;
  volume: number;
  timestamp: string;
  delayed?: boolean;
}

export async function fetchQuote(stockCode: string): Promise<MarketQuoteDTO | null> {
  try {
    const res = await apiClient.get<{ quote: MarketQuoteDTO }>(`/market/quote/${encodeURIComponent(stockCode)}`);
    return res.data.quote ?? null;
  } catch {
    return null;
  }
}

/** 并行拉取多只标的的最新行情（用于切换 tab 时立即刷新） */
export async function fetchQuotesForStockCodes(stockCodes: string[]): Promise<MarketQuoteDTO[]> {
  const unique = [...new Set(stockCodes.filter((c) => c && /^\d{6}$/.test(c)))];
  if (unique.length === 0) return [];
  const results = await Promise.all(unique.map((code) => fetchQuote(code)));
  return results.filter((q): q is MarketQuoteDTO => q != null);
}
