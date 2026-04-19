import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProfitChart from './ProfitChart';
import * as snapshotApi from '../api/snapshot';

jest.mock('../api/snapshot');

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

const mockGetChartData = snapshotApi.getChartData as jest.MockedFunction<typeof snapshotApi.getChartData>;

const mockChartData: snapshotApi.ChartData = {
  profitCurveMeta: { hasCalendarGaps: false },
  profitCurve: [
    { date: '2024-05-28', totalValue: 200000, totalProfit: 5000, totalCost: 195000, returnOnCostPct: 2.56, dayMvChangePct: null, dayProfitDelta: null },
    { date: '2024-05-29', totalValue: 202000, totalProfit: 7000, totalCost: 195000, returnOnCostPct: 3.59, dayMvChangePct: 1, dayProfitDelta: 2000 },
    { date: '2024-05-30', totalValue: 198000, totalProfit: 3000, totalCost: 195000, returnOnCostPct: 1.54, dayMvChangePct: (-2000 / 202000) * 100, dayProfitDelta: -4000 },
  ],
  sectorDistribution: [],
  stockPnl: [],
};

const mockObserve = jest.fn();
const mockDisconnect = jest.fn();

beforeAll(() => {
  (global as any).IntersectionObserver = jest.fn((callback: any) => {
    setTimeout(() => callback([{ isIntersecting: true }]), 0);
    return { observe: mockObserve, disconnect: mockDisconnect, unobserve: jest.fn() };
  });
});

describe('ProfitChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders card container', () => {
    mockGetChartData.mockReturnValue(new Promise(() => {}));
    render(<ProfitChart />);
    expect(screen.getByTestId('profit-chart-card')).toBeInTheDocument();
  });

  it('shows range hint', () => {
    mockGetChartData.mockReturnValue(new Promise(() => {}));
    render(<ProfitChart />);
    expect(screen.getByText('近一年快照')).toBeInTheDocument();
  });

  it('shows loading state', async () => {
    mockGetChartData.mockReturnValue(new Promise(() => {}));
    render(<ProfitChart />);
    await waitFor(() => {
      expect(screen.getByTestId('profit-loading')).toBeInTheDocument();
    });
  });

  it('shows empty state when no data', async () => {
    mockGetChartData.mockResolvedValue({ profitCurve: [], sectorDistribution: [], stockPnl: [] });
    render(<ProfitChart />);
    await waitFor(() => {
      expect(screen.getByTestId('profit-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('暂无收益率数据')).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    mockGetChartData.mockRejectedValue(new Error('fail'));
    render(<ProfitChart />);
    await waitFor(() => {
      expect(screen.getByTestId('profit-error')).toBeInTheDocument();
    });
  });

  it('fetches 365d and renders calendar', async () => {
    mockGetChartData.mockResolvedValue(mockChartData);
    render(<ProfitChart />);
    await waitFor(() => {
      expect(screen.getByTestId('profit-calendar')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(mockGetChartData).toHaveBeenCalledWith('365d');
    });
    expect(screen.getByTestId('calendar-grid')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-cell-2024-05-28')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('month-cumulative-pnl')).toHaveTextContent('-¥2,000.00');
    });
  });

  it('navigates to previous month', async () => {
    mockGetChartData.mockResolvedValue(mockChartData);
    render(<ProfitChart />);
    await waitFor(() => {
      expect(screen.getByTestId('calendar-title')).toHaveTextContent('2024年5月');
    });
    fireEvent.click(screen.getByTestId('calendar-month-prev'));
    expect(screen.getByTestId('calendar-title')).toHaveTextContent('2024年4月');
  });

  it('selects a day and shows detail strip', async () => {
    mockGetChartData.mockResolvedValue(mockChartData);
    render(<ProfitChart />);
    await waitFor(() => {
      expect(screen.getByTestId('calendar-title')).toHaveTextContent('2024年5月');
    });
    fireEvent.click(screen.getByTestId('calendar-cell-2024-05-29'));
    await waitFor(() => {
      expect(screen.getByTestId('day-mv-pct')).toHaveTextContent('+1.00%');
    });
    expect(screen.getByTestId('day-profit-delta')).toHaveTextContent('+¥2,000.00');
    expect(screen.getByTestId('day-cumulative-pnl')).toHaveTextContent('+¥7,000.00');
  });

  it('uses IntersectionObserver for lazy loading', () => {
    mockGetChartData.mockReturnValue(new Promise(() => {}));
    render(<ProfitChart />);
    expect(mockObserve).toHaveBeenCalled();
  });
});
