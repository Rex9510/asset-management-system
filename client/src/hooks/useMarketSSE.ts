import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { fetchQuotesForStockCodes, MarketQuoteDTO } from '../api/market';

export interface SSEQuote {
  stockCode: string;
  stockName: string;
  price: number;
  changePercent: number;
  volume: number;
  timestamp: string;
  delayed?: boolean;
}

interface UseMarketSSEResult {
  quotes: Map<string, SSEQuote>;
  isConnected: boolean;
  isDelayed: boolean;
  /** 立即请求 REST 行情并合并到 quotes（切换 tab 时用；可传入 codes 避免依赖尚未提交的 state） */
  refreshQuotes: (codes?: string[]) => Promise<void>;
}

const MAX_RETRIES = 3;
const RETRY_INTERVALS = [1000, 3000, 5000];

export function useMarketSSE(stockCodes: string[]): UseMarketSSEResult {
  const [quotes, setQuotes] = useState<Map<string, SSEQuote>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [isDelayed, setIsDelayed] = useState(false);
  const retryCountRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stabilize stockCodes reference
  const codesKey = useMemo(() => [...stockCodes].sort().join(','), [stockCodes]);
  const hasStocks = stockCodes.length > 0;
  const stockCodesRef = useRef(stockCodes);
  stockCodesRef.current = stockCodes;

  const refreshQuotes = useCallback(async (codes?: string[]) => {
    const list = codes ?? stockCodesRef.current;
    if (list.length === 0) return;
    const rows = await fetchQuotesForStockCodes(list);
    if (rows.length === 0) return;
    setQuotes((prev) => {
      const next = new Map(prev);
      for (const q of rows) {
        next.set(q.stockCode, quoteDtoToSSE(q));
      }
      return next;
    });
  }, []);

  const cleanup = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || !hasStocks) {
      cleanup();
      return;
    }

    retryCountRef.current = 0;

    function connect() {
      cleanup();

      const currentToken = localStorage.getItem('token');
      if (!currentToken) return;

      const url = `/api/market/sse?token=${encodeURIComponent(currentToken)}`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        retryCountRef.current = 0;
      };

      es.addEventListener('quotes', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as { quotes: SSEQuote[] };
          if (data.quotes) {
            const allDelayed = data.quotes.length > 0 && data.quotes.every(q => q.delayed === true);
            setIsDelayed(allDelayed);

            setQuotes(prev => {
              const next = new Map(prev);
              for (const q of data.quotes) {
                next.set(q.stockCode, q);
              }
              return next;
            });
          }
        } catch {
          // Ignore parse errors
        }
      });

      es.addEventListener('error', (_event: MessageEvent) => {
        try {
          const data = JSON.parse(_event.data);
          if (data.message) {
            setIsDelayed(true);
          }
        } catch {
          // Not a JSON error event
        }
      });

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        setIsConnected(false);

        if (retryCountRef.current < MAX_RETRIES) {
          const delay = RETRY_INTERVALS[retryCountRef.current] ?? RETRY_INTERVALS[RETRY_INTERVALS.length - 1];
          retryCountRef.current++;
          retryTimerRef.current = setTimeout(connect, delay);
        }
      };
    }

    connect();

    return () => {
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey, hasStocks]);

  return { quotes, isConnected, isDelayed, refreshQuotes };
}

function quoteDtoToSSE(q: MarketQuoteDTO): SSEQuote {
  return {
    stockCode: q.stockCode,
    stockName: q.stockName,
    price: q.price,
    changePercent: q.changePercent,
    volume: q.volume,
    timestamp: q.timestamp,
    delayed: q.delayed,
  };
}
