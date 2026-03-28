import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PnlBarChart from './PnlBarChart';
import * as snapshotApi from '../api/snapshot';

jest.mock('../api/snapshot');

const mockGetChartData = snapshotApi.getChartData as jest.MockedFunction<typeof snapshotApi.getChartData>;

const mockChartData: snapshotApi.ChartData = {
  profitCurve: [],
  sectorDistribution: [],
  stockPnl: [
    { stockCode: '600519', stockName: '贵州茅台', profitLoss: 6000, marketValue: 186000 },
    { stockCode: '000858', stockName: '五粮液', profitLoss: 1600, marketValue: 31600 },
    { stockCode: '601318', stockName: '中国平安', profitLoss: -800, marketValue: 14200 },
  ],
};

const mockObserve = jest.fn();
const mockDisconnect = jest.fn();

beforeAll(() => {
  (global as any).IntersectionObserver = jest.fn((callback: any) => {
    setTimeout(() => callback([{ isIntersecting: true }]), 0);
    return { observe: mockObserve, disconnect: mockDisconnect, unobserve: jest.fn() };
  });
});

describe('PnlBarChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders card container', () => {
    mockGetChartData.mockReturnValue(new Promise(() => {}));
    render(<PnlBarChart />);
    expect(screen.getByTestId('pnl-bar-card')).toBeInTheDocument();
  });

  it('shows loading state', async () => {
    mockGetChartData.mockReturnValue(new Promise(() => {}));
    render(<PnlBarChart />);
    await waitFor(() => {
      expect(screen.getByTestId('pnl-loading')).toBeInTheDocument();
    });
  });

  it('shows empty state when no data', async () => {
    mockGetChartData.mockResolvedValue({ profitCurve: [], sectorDistribution: [], stockPnl: [] });
    render(<PnlBarChart />);
    await waitFor(() => {
      expect(screen.getByTestId('pnl-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('暂无盈亏数据')).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    mockGetChartData.mockRejectedValue(new Error('fail'));
    render(<PnlBarChart />);
    await waitFor(() => {
      expect(screen.getByTestId('pnl-error')).toBeInTheDocument();
    });
  });

  it('renders pnl bars with data', async () => {
    mockGetChartData.mockResolvedValue(mockChartData);
    render(<PnlBarChart />);
    await waitFor(() => {
      expect(screen.getByTestId('pnl-bars')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pnl-item-0')).toBeInTheDocument();
    expect(screen.getByTestId('pnl-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('pnl-item-2')).toBeInTheDocument();
  });

  it('displays stock names', async () => {
    mockGetChartData.mockResolvedValue(mockChartData);
    render(<PnlBarChart />);
    await waitFor(() => {
      expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    });
    expect(screen.getByText('五粮液')).toBeInTheDocument();
    expect(screen.getByText('中国平安')).toBeInTheDocument();
  });

  it('shows green for loss and red for profit', async () => {
    mockGetChartData.mockResolvedValue(mockChartData);
    render(<PnlBarChart />);
    await waitFor(() => {
      expect(screen.getByTestId('pnl-bars')).toBeInTheDocument();
    });
    // Profit bar should have red-ish border
    const profitBar = screen.getByTestId('pnl-bar-0');
    expect(profitBar).toHaveStyle({ borderLeft: '3px solid #ff4d4f' });
    // Loss bar should have green-ish border
    const lossBar = screen.getByTestId('pnl-bar-2');
    expect(lossBar).toHaveStyle({ borderLeft: '3px solid #52c41a' });
  });

  it('displays stock codes', async () => {
    mockGetChartData.mockResolvedValue(mockChartData);
    render(<PnlBarChart />);
    await waitFor(() => {
      expect(screen.getByText('600519')).toBeInTheDocument();
    });
    expect(screen.getByText('000858')).toBeInTheDocument();
    expect(screen.getByText('601318')).toBeInTheDocument();
  });

  it('uses IntersectionObserver for lazy loading', () => {
    mockGetChartData.mockReturnValue(new Promise(() => {}));
    render(<PnlBarChart />);
    expect(mockObserve).toHaveBeenCalled();
  });
});
