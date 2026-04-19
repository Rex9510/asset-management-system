import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SectorPieChart from './SectorPieChart';
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
  profitCurve: [],
  sectorDistribution: [
    { sector: '消费', value: 216000, percentage: 65.5 },
    { sector: '金融', value: 78000, percentage: 23.6 },
    { sector: '科技', value: 36000, percentage: 10.9 },
  ],
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

describe('SectorPieChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders card container', () => {
    mockGetChartData.mockReturnValue(new Promise(() => {}));
    render(<SectorPieChart />);
    expect(screen.getByTestId('sector-pie-card')).toBeInTheDocument();
  });

  it('shows loading state', async () => {
    mockGetChartData.mockReturnValue(new Promise(() => {}));
    render(<SectorPieChart />);
    await waitFor(() => {
      expect(screen.getByTestId('sector-loading')).toBeInTheDocument();
    });
  });

  it('shows empty state when no data', async () => {
    mockGetChartData.mockResolvedValue({ profitCurve: [], sectorDistribution: [], stockPnl: [] });
    render(<SectorPieChart />);
    await waitFor(() => {
      expect(screen.getByTestId('sector-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('暂无板块分布数据')).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    mockGetChartData.mockRejectedValue(new Error('fail'));
    render(<SectorPieChart />);
    await waitFor(() => {
      expect(screen.getByTestId('sector-error')).toBeInTheDocument();
    });
  });

  it('renders sector bars with data', async () => {
    mockGetChartData.mockResolvedValue(mockChartData);
    render(<SectorPieChart />);
    await waitFor(() => {
      expect(screen.getByTestId('sector-bars')).toBeInTheDocument();
    });
    expect(screen.getByTestId('sector-item-0')).toBeInTheDocument();
    expect(screen.getByTestId('sector-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('sector-item-2')).toBeInTheDocument();
  });

  it('displays sector names and percentages', async () => {
    mockGetChartData.mockResolvedValue(mockChartData);
    render(<SectorPieChart />);
    await waitFor(() => {
      expect(screen.getByText('消费')).toBeInTheDocument();
    });
    expect(screen.getByText('65.5%')).toBeInTheDocument();
    expect(screen.getByText('金融')).toBeInTheDocument();
    expect(screen.getByText('科技')).toBeInTheDocument();
  });

  it('renders donut ring', async () => {
    mockGetChartData.mockResolvedValue(mockChartData);
    render(<SectorPieChart />);
    await waitFor(() => {
      expect(screen.getByTestId('donut-ring')).toBeInTheDocument();
    });
  });

  it('uses IntersectionObserver for lazy loading', () => {
    mockGetChartData.mockReturnValue(new Promise(() => {}));
    render(<SectorPieChart />);
    expect(mockObserve).toHaveBeenCalled();
  });
});
