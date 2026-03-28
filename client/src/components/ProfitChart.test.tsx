import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProfitChart from './ProfitChart';
import * as snapshotApi from '../api/snapshot';

jest.mock('../api/snapshot');

const mockGetChartData = snapshotApi.getChartData as jest.MockedFunction<typeof snapshotApi.getChartData>;

const mockChartData: snapshotApi.ChartData = {
  profitCurve: [
    { date: '2024-05-28', totalValue: 200000, totalProfit: 5000 },
    { date: '2024-05-29', totalValue: 202000, totalProfit: 7000 },
    { date: '2024-05-30', totalValue: 198000, totalProfit: 3000 },
  ],
  sectorDistribution: [],
  stockPnl: [],
};

// Mock IntersectionObserver
const mockObserve = jest.fn();
const mockDisconnect = jest.fn();

beforeAll(() => {
  (global as any).IntersectionObserver = jest.fn((callback: any) => {
    // Immediately trigger as visible
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

  it('shows period tabs', () => {
    mockGetChartData.mockReturnValue(new Promise(() => {}));
    render(<ProfitChart />);
    expect(screen.getByTestId('period-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('period-tab-7d')).toHaveTextContent('7天');
    expect(screen.getByTestId('period-tab-30d')).toHaveTextContent('30天');
    expect(screen.getByTestId('period-tab-90d')).toHaveTextContent('90天');
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
    expect(screen.getByText('暂无收益数据')).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    mockGetChartData.mockRejectedValue(new Error('fail'));
    render(<ProfitChart />);
    await waitFor(() => {
      expect(screen.getByTestId('profit-error')).toBeInTheDocument();
    });
  });

  it('renders curve bars with data', async () => {
    mockGetChartData.mockResolvedValue(mockChartData);
    render(<ProfitChart />);
    await waitFor(() => {
      expect(screen.getByTestId('profit-curve')).toBeInTheDocument();
    });
    expect(screen.getByTestId('curve-bar-0')).toBeInTheDocument();
    expect(screen.getByTestId('curve-bar-1')).toBeInTheDocument();
    expect(screen.getByTestId('curve-bar-2')).toBeInTheDocument();
  });

  it('switches period on tab click', async () => {
    mockGetChartData.mockResolvedValue(mockChartData);
    render(<ProfitChart />);
    await waitFor(() => {
      expect(screen.getByTestId('profit-curve')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('period-tab-7d'));
    await waitFor(() => {
      expect(mockGetChartData).toHaveBeenCalledWith('7d');
    });
  });

  it('uses IntersectionObserver for lazy loading', () => {
    mockGetChartData.mockReturnValue(new Promise(() => {}));
    render(<ProfitChart />);
    expect(mockObserve).toHaveBeenCalled();
  });
});
