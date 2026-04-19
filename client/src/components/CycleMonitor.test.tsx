import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CycleMonitor from './CycleMonitor';
import * as cycleApi from '../api/cycle';
import * as positionsApi from '../api/positions';

jest.mock('../api/cycle');
jest.mock('../api/positions', () => ({
  searchStockCandidates: jest.fn(),
}));

const mockGetMonitors = cycleApi.getCycleMonitors as jest.MockedFunction<typeof cycleApi.getCycleMonitors>;
const mockAddMonitor = cycleApi.addCycleMonitor as jest.MockedFunction<typeof cycleApi.addCycleMonitor>;
const mockDeleteMonitor = cycleApi.deleteCycleMonitor as jest.MockedFunction<typeof cycleApi.deleteCycleMonitor>;
const mockSearch = positionsApi.searchStockCandidates as jest.MockedFunction<typeof positionsApi.searchStockCandidates>;

const mockMonitors: cycleApi.CycleMonitorData[] = [
  {
    id: 1,
    stockCode: '600519',
    stockName: '贵州茅台',
    cycleLength: '约6年',
    currentPhase: '高位区域',
    status: 'high',
    description: '参考约6年历史区间。当前处于高位运行，已运行约3个月，注意回调风险',
    bottomSignals: [],
    updatedAt: '2024-01-15T16:40:00Z',
    currentMonths: 3,
    cycleLengthMonths: 72,
    currentPrice: 1856.00,
    changePercent: 2.35,
  },
  {
    id: 2,
    stockCode: '601012',
    stockName: '隆基绿能',
    cycleLength: '约3年',
    currentPhase: '底部区域',
    status: 'bottom',
    description: '参考约4年历史区间。当前处于横盘末期，已横盘约6个月',
    bottomSignals: ['价格处于近4年最低30%区间', 'RSI低于30超卖'],
    updatedAt: '2024-01-15T16:40:00Z',
    currentMonths: 6,
    cycleLengthMonths: 36,
    currentPrice: 28.65,
    changePercent: -1.28,
  },
];

describe('CycleMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    mockGetMonitors.mockReturnValue(new Promise(() => {}));
    render(<CycleMonitor />);
    expect(screen.getByTestId('cycle-loading')).toBeInTheDocument();
  });

  it('hides when API fails', async () => {
    mockGetMonitors.mockRejectedValue(new Error('Network error'));
    const { container } = render(<CycleMonitor />);
    await waitFor(() => {
      expect(screen.queryByTestId('cycle-loading')).not.toBeInTheDocument();
    });
    expect(container.querySelector('[data-testid="cycle-monitor-card"]')).not.toBeInTheDocument();
  });

  it('renders card title', async () => {
    mockGetMonitors.mockResolvedValue(mockMonitors);
    render(<CycleMonitor />);
    await waitFor(() => {
      expect(screen.getByText('🔄 周期监控')).toBeInTheDocument();
    });
  });

  it('shows empty state when no monitors', async () => {
    mockGetMonitors.mockResolvedValue([]);
    render(<CycleMonitor />);
    await waitFor(() => {
      expect(screen.getByTestId('cycle-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('暂无周期监控')).toBeInTheDocument();
  });

  it('renders monitor items with stock info', async () => {
    mockGetMonitors.mockResolvedValue(mockMonitors);
    render(<CycleMonitor />);
    await waitFor(() => {
      expect(screen.getByTestId('cycle-list')).toBeInTheDocument();
    });
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    expect(screen.getByText('600519')).toBeInTheDocument();
    expect(screen.getByText('隆基绿能')).toBeInTheDocument();
    expect(screen.getByText('601012')).toBeInTheDocument();
  });

  it('shows correct status badges', async () => {
    mockGetMonitors.mockResolvedValue(mockMonitors);
    render(<CycleMonitor />);
    await waitFor(() => {
      expect(screen.getByTestId('cycle-status-1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('cycle-status-1')).toHaveAttribute('data-status', 'high');
    expect(screen.getByTestId('cycle-status-2')).toHaveAttribute('data-status', 'bottom');
  });

  it('shows description text', async () => {
    mockGetMonitors.mockResolvedValue(mockMonitors);
    render(<CycleMonitor />);
    await waitFor(() => {
      expect(screen.getByTestId('cycle-desc-1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('cycle-desc-1').textContent).toMatch(/高位/);
    expect(screen.getByTestId('cycle-desc-2').textContent).toMatch(/底部|横盘末期/);
  });

  it('shows cycle length info', async () => {
    mockGetMonitors.mockResolvedValue(mockMonitors);
    render(<CycleMonitor />);
    await waitFor(() => {
      expect(screen.getByText(/周期节奏：约6年一轮/)).toBeInTheDocument();
    });
    expect(screen.getByText(/周期节奏：约3年一轮/)).toBeInTheDocument();
  });

  it('toggles add input on button click', async () => {
    mockGetMonitors.mockResolvedValue([]);
    render(<CycleMonitor />);
    await waitFor(() => {
      expect(screen.getByTestId('cycle-add-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('cycle-add-toggle'));
    expect(screen.getByTestId('cycle-input-row')).toBeInTheDocument();
    expect(screen.getByTestId('cycle-stock-input')).toBeInTheDocument();
  });

  it('calls addCycleMonitor after selecting a candidate from search', async () => {
    mockGetMonitors.mockResolvedValue([]);
    mockAddMonitor.mockResolvedValue(mockMonitors[0]);
    mockSearch.mockResolvedValue([{ stockCode: '600519', stockName: '贵州茅台' }]);
    render(<CycleMonitor />);
    await waitFor(() => {
      expect(screen.getByTestId('cycle-add-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('cycle-add-toggle'));
    fireEvent.change(screen.getByTestId('cycle-stock-input'), { target: { value: '茅台' } });
    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith('茅台');
    });
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('贵州茅台'));
    expect(screen.getByTestId('cycle-selected-hint')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cycle-submit-btn'));
    await waitFor(() => {
      expect(mockAddMonitor).toHaveBeenCalledWith('600519', '贵州茅台');
    });
  });

  it('shows validation when submitting without selecting a candidate', async () => {
    mockGetMonitors.mockResolvedValue([]);
    mockSearch.mockResolvedValue([{ stockCode: '600000', stockName: '浦发银行' }]);
    render(<CycleMonitor />);
    await waitFor(() => {
      expect(screen.getByTestId('cycle-add-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('cycle-add-toggle'));
    fireEvent.change(screen.getByTestId('cycle-stock-input'), { target: { value: '仅输入不点选' } });
    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByTestId('cycle-submit-btn'));
    expect(await screen.findByRole('alert')).toHaveTextContent('请从搜索结果中选择股票');
    expect(mockAddMonitor).not.toHaveBeenCalled();
  });

  it('calls deleteCycleMonitor on delete button click', async () => {
    mockGetMonitors.mockResolvedValue(mockMonitors);
    mockDeleteMonitor.mockResolvedValue(undefined);
    render(<CycleMonitor />);
    await waitFor(() => {
      expect(screen.getByTestId('cycle-delete-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('cycle-delete-1'));
    await waitFor(() => {
      expect(mockDeleteMonitor).toHaveBeenCalledWith(1);
    });
  });

  it('shows month labels on progress bar when data available', async () => {
    mockGetMonitors.mockResolvedValue(mockMonitors);
    render(<CycleMonitor />);
    await waitFor(() => {
      expect(screen.getByText('第3月')).toBeInTheDocument();
    });
    expect(screen.getByText('第6月')).toBeInTheDocument();
  });

  it('shows remaining months info', async () => {
    mockGetMonitors.mockResolvedValue(mockMonitors);
    render(<CycleMonitor />);
    await waitFor(() => {
      expect(screen.getByText(/余21月/)).toBeInTheDocument(); // phase=72/3=24, 24-3=21
    });
    expect(screen.getByText(/余6月/)).toBeInTheDocument(); // phase=36/3=12, 12-6=6
  });
});
