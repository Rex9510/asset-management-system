import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import DeepReportModal from './DeepReportModal';
import * as deepAnalysisApi from '../api/deepAnalysis';

jest.mock('../api/deepAnalysis');

const mockGetDeepReport = deepAnalysisApi.getDeepReport as jest.MockedFunction<typeof deepAnalysisApi.getDeepReport>;

function makeReport(overrides: Partial<deepAnalysisApi.DeepReport> = {}): deepAnalysisApi.DeepReport {
  return {
    id: 1,
    userId: 1,
    stockCode: '600000',
    stockName: '浦发银行',
    conclusion: '当前处于上升阶段，参考方案为持有',
    fundamentals: '行业地位稳固，竞争优势明显',
    financials: '营收稳定增长，利润率良好',
    valuation: 'PE处于历史25%分位，估值偏低',
    strategy: '参考操作方案：持有为主，回调可加仓',
    aiModel: 'deepseek-chat',
    confidence: 75,
    dataCutoffDate: '2024-06-01',
    status: 'completed',
    createdAt: '2024-06-01T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('DeepReportModal', () => {
  it('shows loading state while generating', async () => {
    mockGetDeepReport.mockResolvedValue(makeReport({ status: 'generating' }));
    render(<DeepReportModal stockCode="600000" reportId={1} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/AI正在生成深度分析报告/)).toBeInTheDocument();
    });
  });

  it('renders completed report with all sections', async () => {
    mockGetDeepReport.mockResolvedValue(makeReport());
    render(<DeepReportModal stockCode="600000" reportId={1} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/📌 结论先行/)).toBeInTheDocument();
    });
    expect(screen.getByText(/📊 基本面分析/)).toBeInTheDocument();
    expect(screen.getByText(/💰 核心财务数据/)).toBeInTheDocument();
    expect(screen.getByText(/📐 估值分位/)).toBeInTheDocument();
    expect(screen.getByText(/🎯 交易策略/)).toBeInTheDocument();
    expect(screen.getByText('当前处于上升阶段，参考方案为持有')).toBeInTheDocument();
    expect(screen.getByText(/仅供学习参考，不构成投资依据/)).toBeInTheDocument();
    expect(screen.getByText(/2024-06-01/)).toBeInTheDocument();
  });

  it('shows failed state with retry button', async () => {
    mockGetDeepReport.mockResolvedValue(makeReport({ status: 'failed' }));
    render(<DeepReportModal stockCode="600000" reportId={1} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('报告生成失败')).toBeInTheDocument();
    });
    expect(screen.getByText(/重新获取/)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = jest.fn();
    mockGetDeepReport.mockResolvedValue(makeReport());
    render(<DeepReportModal stockCode="600000" reportId={1} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText(/📌 结论先行/)).toBeInTheDocument();
    });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when overlay is clicked', async () => {
    const onClose = jest.fn();
    mockGetDeepReport.mockResolvedValue(makeReport());
    render(<DeepReportModal stockCode="600000" reportId={1} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText(/📌 结论先行/)).toBeInTheDocument();
    });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows disclaimer text', async () => {
    mockGetDeepReport.mockResolvedValue(makeReport());
    render(<DeepReportModal stockCode="600000" reportId={1} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/仅供学习参考，不构成投资依据/)).toBeInTheDocument();
    });
  });

  it('polls when status is generating and stops when completed', async () => {
    mockGetDeepReport
      .mockResolvedValueOnce(makeReport({ status: 'generating' }))
      .mockResolvedValueOnce(makeReport({ status: 'completed' }));

    render(<DeepReportModal stockCode="600000" reportId={1} onClose={jest.fn()} />);

    // First call: generating
    await waitFor(() => {
      expect(mockGetDeepReport).toHaveBeenCalledTimes(1);
    });

    // Advance timer to trigger poll
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(mockGetDeepReport).toHaveBeenCalledTimes(2);
    });

    // Should now show completed content
    await waitFor(() => {
      expect(screen.getByText(/📌 结论先行/)).toBeInTheDocument();
    });
  });

  it('displays stock name in header', async () => {
    mockGetDeepReport.mockResolvedValue(makeReport());
    render(<DeepReportModal stockCode="600000" reportId={1} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/浦发银行（600000）/)).toBeInTheDocument();
    });
  });
});
