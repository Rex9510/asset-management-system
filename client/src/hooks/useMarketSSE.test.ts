import { renderHook, act } from '@testing-library/react';
import { useMarketSSE } from './useMarketSSE';

jest.mock('../api/market', () => ({
  fetchQuotesForStockCodes: jest.fn().mockResolvedValue([]),
}));

const marketApi = require('../api/market') as { fetchQuotesForStockCodes: jest.Mock };

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Record<string, ((event: MessageEvent) => void)[]> = {};
  readyState = 0;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener() {}

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  // Test helpers
  simulateOpen() {
    this.readyState = 1;
    if (this.onopen) this.onopen();
  }

  simulateMessage(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    const handlers = this.listeners[type] || [];
    for (const h of handlers) h(event);
  }

  simulateError() {
    if (this.onerror) this.onerror();
  }

  static reset() {
    MockEventSource.instances = [];
  }

  static latest(): MockEventSource | undefined {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }
}

(global as any).EventSource = MockEventSource;

beforeEach(() => {
  MockEventSource.reset();
  localStorage.setItem('token', 'test-token');
  jest.useFakeTimers();
  marketApi.fetchQuotesForStockCodes.mockResolvedValue([]);
});

afterEach(() => {
  localStorage.clear();
  jest.useRealTimers();
});

describe('useMarketSSE', () => {
  it('connects to SSE endpoint with token', () => {
    renderHook(() => useMarketSSE(['600000']));
    const es = MockEventSource.latest();
    expect(es).toBeDefined();
    expect(es!.url).toContain('/api/market/sse');
    expect(es!.url).toContain('token=test-token');
  });

  it('refreshQuotes merges REST results when codes passed explicitly', async () => {
    marketApi.fetchQuotesForStockCodes.mockResolvedValueOnce([
      { stockCode: '600000', stockName: '浦发银行', price: 12.34, changePercent: 2.5, volume: 1000, timestamp: '2024-01-01T00:00:00Z' },
    ]);
    const { result } = renderHook(() => useMarketSSE([]));
    await act(async () => {
      await result.current.refreshQuotes(['600000']);
    });
    expect(result.current.quotes.get('600000')).toEqual(
      expect.objectContaining({ stockCode: '600000', price: 12.34, changePercent: 2.5 })
    );
  });

  it('does not connect when no stock codes', () => {
    renderHook(() => useMarketSSE([]));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('does not connect when no token', () => {
    localStorage.removeItem('token');
    renderHook(() => useMarketSSE(['600000']));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('sets isConnected on open and updates quotes', () => {
    const { result } = renderHook(() => useMarketSSE(['600000']));
    const es = MockEventSource.latest()!;

    act(() => es.simulateOpen());
    expect(result.current.isConnected).toBe(true);

    act(() => {
      es.simulateMessage('quotes', {
        quotes: [
          { stockCode: '600000', stockName: '浦发银行', price: 11.5, changePercent: 2.1, volume: 100000, timestamp: '2024-01-01T00:00:00Z' },
        ],
      });
    });

    expect(result.current.quotes.get('600000')).toEqual(
      expect.objectContaining({ stockCode: '600000', price: 11.5 })
    );
  });

  it('sets isDelayed when all quotes are delayed', () => {
    const { result } = renderHook(() => useMarketSSE(['600000']));
    const es = MockEventSource.latest()!;

    act(() => {
      es.simulateOpen();
      es.simulateMessage('quotes', {
        quotes: [
          { stockCode: '600000', stockName: '浦发银行', price: 11.5, changePercent: 2.1, volume: 100000, timestamp: '2024-01-01T00:00:00Z', delayed: true },
        ],
      });
    });

    expect(result.current.isDelayed).toBe(true);
  });

  it('sets isDelayed to false when not all quotes are delayed', () => {
    const { result } = renderHook(() => useMarketSSE(['600000', '000001']));
    const es = MockEventSource.latest()!;

    act(() => {
      es.simulateOpen();
      es.simulateMessage('quotes', {
        quotes: [
          { stockCode: '600000', stockName: '浦发银行', price: 11.5, changePercent: 2.1, volume: 100000, timestamp: '2024-01-01T00:00:00Z', delayed: true },
          { stockCode: '000001', stockName: '平安银行', price: 15.0, changePercent: 1.0, volume: 200000, timestamp: '2024-01-01T00:00:00Z' },
        ],
      });
    });

    expect(result.current.isDelayed).toBe(false);
  });

  it('closes connection on unmount', () => {
    const { unmount } = renderHook(() => useMarketSSE(['600000']));
    const es = MockEventSource.latest()!;

    act(() => es.simulateOpen());
    unmount();

    expect(es.closed).toBe(true);
  });

  it('retries on error with incrementing delays (max 3)', () => {
    renderHook(() => useMarketSSE(['600000']));
    expect(MockEventSource.instances).toHaveLength(1);

    // First error -> retry after 1s
    const es1 = MockEventSource.latest()!;
    act(() => es1.simulateError());

    act(() => { jest.advanceTimersByTime(1000); });
    expect(MockEventSource.instances).toHaveLength(2);

    // Second error -> retry after 3s
    const es2 = MockEventSource.latest()!;
    act(() => es2.simulateError());
    act(() => { jest.advanceTimersByTime(3000); });
    expect(MockEventSource.instances).toHaveLength(3);

    // Third error -> retry after 5s
    const es3 = MockEventSource.latest()!;
    act(() => es3.simulateError());
    act(() => { jest.advanceTimersByTime(5000); });
    expect(MockEventSource.instances).toHaveLength(4);

    // Fourth error -> no more retries (max 3 retries reached)
    const es4 = MockEventSource.latest()!;
    act(() => es4.simulateError());
    act(() => { jest.advanceTimersByTime(10000); });
    expect(MockEventSource.instances).toHaveLength(4);
  });

  it('resets retry count on successful reconnection', () => {
    renderHook(() => useMarketSSE(['600000']));
    expect(MockEventSource.instances).toHaveLength(1);

    // First error -> retry after 1s
    const es1 = MockEventSource.latest()!;
    act(() => es1.simulateError());
    act(() => { jest.advanceTimersByTime(1000); });
    expect(MockEventSource.instances).toHaveLength(2);

    // Successful reconnection resets retry count
    const es2 = MockEventSource.latest()!;
    act(() => es2.simulateOpen());

    // Error again -> should retry from count 0 (1s delay)
    act(() => es2.simulateError());
    act(() => { jest.advanceTimersByTime(1000); });
    expect(MockEventSource.instances).toHaveLength(3);

    // Can still retry 2 more times
    const es3 = MockEventSource.latest()!;
    act(() => es3.simulateError());
    act(() => { jest.advanceTimersByTime(3000); });
    expect(MockEventSource.instances).toHaveLength(4);
  });
});
