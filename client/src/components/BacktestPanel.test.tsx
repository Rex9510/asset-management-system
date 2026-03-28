import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import BacktestPanel from './BacktestPanel';
import * as backtestApi from '../api/backtest';

jest.mock('../api/backtest');

const mockRunBacktest = backtestApi.runBacktest as jest.MockedFunction<typeof backtestApi.runBacktest>;

function makeResult(overrides: Partial<backtestApi.BacktestResult> = {}): backtestApi.BacktestResult {
  return {
    stockCode: '600000',
    currentPercentile: 25.5,
    matchingPoints: 12,
    results: [
      { period: '30d', winRate: 0.6667, avgReturn: 0.0350, maxReturn: 0.1200, maxLoss: -0.0500, medianReturn: 0.0300 },
      { period: '90d', winRate: 0.7500, avgReturn: 0.0800, maxReturn: 0.2500, maxLoss: -0.0800, medianReturn: 0.0700 },
      { period: '180d', winRate: 0.5833, avgReturn: 0.0500, maxReturn: 0.3000, maxLoss: -0.1500, medianReturn: 0.0400 },
      { period: '365d', winRate: 0.5000, avgReturn: 0.0200, maxReturn: 0.4000, maxLoss: -0.2000, medianReturn: 0.0100 },
    ],
    sampleWarning: false,
    summary: '历史类似位置买入，半年维度胜率58%，平均收益5.0%，整体中性偏强',
    disclaimer: '以上内容仅供学习参考，不构成投资依据',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BacktestPanel', () => {
  it('shows loading state initially', () => {
    mockRunBacktest.mockReturnValue(new Promise(() => {}));
    render(<BacktestPanel stockCode="600000" onClose={jest.fn()} />);
    expect(screen.getByText('正在计算回测数据...')).toBeInTheDocument();
  });

  it('renders backtest results with all period cards', async () => {
    mockRunBacktest.mockResolvedValue(makeResult());
    render(<BacktestPanel stockCode="600000" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('25.5%')).toBeInTheDocument();
    });
    expect(screen.getByText('12个')).toBeInTheDocument();

    // Period titles
    expect(screen.getByText('30天')).toBeInTheDocument();
    expect(screen.getByText('90天')).toBeInTheDocument();
    expect(screen.getByText('180天')).toBeInTheDocument();
    expect(screen.getByText('365天')).toBeInTheDocument();
  });

  it('shows sample warning when matchingPoints < 5', async () => {
    mockRunBacktest.mockResolvedValue(makeResult({ matchingPoints: 3, sampleWarning: true }));
    render(<BacktestPanel stockCode="600000" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/匹配时点不足5个/)).toBeInTheDocument();
  });

  it('does not show sample warning when enough points', async () => {
    mockRunBacktest.mockResolvedValue(makeResult({ sampleWarning: false }));
    render(<BacktestPanel stockCode="600000" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('25.5%')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows disclaimer text', async () => {
    mockRunBacktest.mockResolvedValue(makeResult());
    render(<BacktestPanel stockCode="600000" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('以上内容仅供学习参考，不构成投资依据')).toBeInTheDocument();
    });
  });

  it('shows summary card', async () => {
    mockRunBacktest.mockResolvedValue(makeResult());
    render(<BacktestPanel stockCode="600000" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/历史类似位置买入/)).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    mockRunBacktest.mockRejectedValue(new Error('fail'));
    render(<BacktestPanel stockCode="600000" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('回测计算失败')).toBeInTheDocument();
    });
    expect(screen.getByText(/重试/)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = jest.fn();
    mockRunBacktest.mockResolvedValue(makeResult());
    render(<BacktestPanel stockCode="600000" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('25.5%')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when overlay is clicked', async () => {
    const onClose = jest.fn();
    mockRunBacktest.mockResolvedValue(makeResult());
    render(<BacktestPanel stockCode="600000" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('25.5%')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders header title', async () => {
    mockRunBacktest.mockResolvedValue(makeResult());
    render(<BacktestPanel stockCode="600000" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/历史回测/)).toBeInTheDocument();
    });
  });

  it('displays win rate stats with correct labels', async () => {
    mockRunBacktest.mockResolvedValue(makeResult());
    render(<BacktestPanel stockCode="600000" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByText('胜率')).toHaveLength(4);
    });
    expect(screen.getAllByText('平均收益')).toHaveLength(4);
    expect(screen.getAllByText('最大收益')).toHaveLength(4);
    expect(screen.getAllByText('最大亏损')).toHaveLength(4);
    expect(screen.getAllByText('中位收益')).toHaveLength(4);
  });
});
