/**
 * 图表组件懒加载测试（IntersectionObserver 触发）
 * Task 28.1
 */
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock IntersectionObserver
let observerCallback: IntersectionObserverCallback;
let observerInstance: { observe: jest.Mock; disconnect: jest.Mock; unobserve: jest.Mock };

beforeEach(() => {
  observerInstance = {
    observe: jest.fn(),
    disconnect: jest.fn(),
    unobserve: jest.fn(),
  };

  (global as any).IntersectionObserver = jest.fn((callback: IntersectionObserverCallback) => {
    observerCallback = callback;
    return observerInstance;
  });

  // Clear mock call counts between tests
  const snapshotApi = require('../api/snapshot');
  snapshotApi.getChartData.mockClear();
});

// Mock chart.js to avoid canvas issues in jsdom
jest.mock('chart.js', () => ({}), { virtual: true });
jest.mock('react-chartjs-2', () => ({
  Line: () => <div data-testid="line-chart">Line Chart</div>,
  Pie: () => <div data-testid="pie-chart">Pie Chart</div>,
  Bar: () => <div data-testid="bar-chart">Bar Chart</div>,
}), { virtual: true });

jest.mock('../api/positions', () => ({
  getPositions: jest.fn().mockResolvedValue([]),
}));

jest.mock('../hooks/useMarketSSE', () => ({
  useMarketSSE: () => ({
    quotes: new Map(),
    refreshQuotes: jest.fn().mockResolvedValue(undefined),
    isConnected: false,
    isDelayed: false,
  }),
}));

jest.mock('../api/snapshot', () => ({
  getChartData: jest.fn().mockResolvedValue({
    profitCurveMeta: { hasCalendarGaps: false },
    profitCurve: [
      { date: '2025-01-01', totalValue: 10000, totalProfit: 500, totalCost: 9500, returnOnCostPct: 5.26, dayMvChangePct: null, dayProfitDelta: null },
      { date: '2025-01-02', totalValue: 10200, totalProfit: 700, totalCost: 9500, returnOnCostPct: 7.37, dayMvChangePct: 2, dayProfitDelta: 200 },
    ],
    sectorDistribution: [
      { sector: '金融', percentage: 60, value: 6000 },
      { sector: '科技', percentage: 40, value: 4000 },
    ],
    stockPnl: [
      { stockCode: '600000', stockName: '浦发银行', pnl: 500 },
      { stockCode: '000001', stockName: '平安银行', pnl: -200 },
    ],
  }),
}));

// Import after mocks
import ProfitChart from './ProfitChart';

describe('ProfitChart lazy loading', () => {
  it('renders container but does not fetch data before intersection', () => {
    const snapshotApi = require('../api/snapshot');
    render(<ProfitChart />);

    expect(screen.getByTestId('profit-chart-card')).toBeInTheDocument();
    expect(observerInstance.observe).toHaveBeenCalled();
    // Data should not be fetched yet (not visible)
    expect(snapshotApi.getChartData).not.toHaveBeenCalled();
  });

  it('fetches data after IntersectionObserver triggers', async () => {
    const snapshotApi = require('../api/snapshot');
    render(<ProfitChart />);

    // Simulate intersection
    await act(async () => {
      observerCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(snapshotApi.getChartData).toHaveBeenCalled();
    expect(observerInstance.disconnect).toHaveBeenCalled();
  });

  it('does not fetch data when not intersecting', async () => {
    const snapshotApi = require('../api/snapshot');
    render(<ProfitChart />);

    await act(async () => {
      observerCallback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(snapshotApi.getChartData).not.toHaveBeenCalled();
  });
});
