import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AnalysisPanel from './AnalysisPanel';
import * as analysisApi from '../api/analysis';

jest.mock('../api/analysis');

const mockGetAnalysis = analysisApi.getAnalysis as jest.MockedFunction<typeof analysisApi.getAnalysis>;
const mockGetIndicators = analysisApi.getIndicators as jest.MockedFunction<typeof analysisApi.getIndicators>;
const mockGetRiskAlerts = analysisApi.getRiskAlerts as jest.MockedFunction<typeof analysisApi.getRiskAlerts>;

function makeAnalysis(overrides: Partial<analysisApi.AnalysisData> = {}): analysisApi.AnalysisData {
  return {
    id: 1,
    userId: 1,
    stockCode: '600000',
    stockName: '浦发银行',
    triggerType: 'scheduled',
    stage: 'rising',
    spaceEstimate: '上方空间约15%',
    keySignals: ['MACD金叉', '量价配合良好'],
    actionRef: 'hold',
    batchPlan: [
      { action: 'sell', shares: 300, targetPrice: 15.0, note: '锁定部分利润' },
    ],
    confidence: 82,
    reasoning: '技术面多头排列，基本面稳健，短期看多。',
    dataSources: ['eastmoney', 'sina'],
    technicalIndicators: null,
    newsSummary: [],
    recoveryEstimate: null,
    profitEstimate: '按当前趋势，持有30天预计收益区间5%-12%',
    riskAlerts: ['量价背离，警惕主力出货'],
    targetPrice: { low: 14.0, high: 16.5 },
    positionStrategy: {
      profitPosition: { percent: 30, action: '可考虑减仓锁定利润' },
      basePosition: { percent: 70, action: '继续持有' },
    },
    createdAt: '2024-06-01T10:00:00Z',
    ...overrides,
  };
}

function setupIndicatorMocks() {
  mockGetIndicators.mockResolvedValue({
    stockCode: '600000',
    tradeDate: '2024-06-01',
    ma: { ma5: 12.5, ma10: 12.3, ma20: 12.0, ma60: 11.5 },
    macd: { dif: 0.15, dea: 0.10, histogram: 0.05 },
    kdj: { k: 65, d: 55, j: 85 },
    rsi: { rsi6: 58, rsi12: 55, rsi24: 52 },
    signals: {
      ma: { direction: 'bullish', label: '多头排列，短期看多' },
      macd: { direction: 'bullish', label: 'MACD金叉，短期看多' },
      kdj: { direction: 'neutral', label: 'KDJ中性震荡' },
      rsi: { direction: 'neutral', label: 'RSI中性区间' },
    },
    updatedAt: '2024-06-01T10:00:00Z',
  });
  mockGetRiskAlerts.mockResolvedValue([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  setupIndicatorMocks();
});

describe('AnalysisPanel', () => {
  it('shows loading state initially', () => {
    mockGetAnalysis.mockReturnValue(new Promise(() => {}));
    render(<AnalysisPanel stockCode="600000" />);
    expect(screen.getByText('分析加载中...')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    mockGetAnalysis.mockRejectedValue(new Error('fail'));
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('暂无分析数据')).toBeInTheDocument();
    });
  });

  it('renders stage label and space estimate', async () => {
    mockGetAnalysis.mockResolvedValue(makeAnalysis());
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('上升阶段')).toBeInTheDocument();
    });
    expect(screen.getByText(/空间预估：上方空间约15%/)).toBeInTheDocument();
  });

  it('renders all stage labels correctly', async () => {
    const stages: Array<{ stage: string; label: string }> = [
      { stage: 'bottom', label: '底部阶段' },
      { stage: 'rising', label: '上升阶段' },
      { stage: 'main_wave', label: '主升浪阶段' },
      { stage: 'high', label: '高位阶段' },
      { stage: 'falling', label: '下跌阶段' },
    ];

    for (const { stage, label } of stages) {
      mockGetAnalysis.mockResolvedValue(makeAnalysis({ stage }));
      const { unmount } = render(<AnalysisPanel stockCode="600000" />);
      await waitFor(() => {
        expect(screen.getByText(label)).toBeInTheDocument();
      });
      unmount();
    }
  });

  describe('confidence levels', () => {
    it('shows 🟢高置信 for confidence >= 80', async () => {
      mockGetAnalysis.mockResolvedValue(makeAnalysis({ confidence: 85 }));
      render(<AnalysisPanel stockCode="600000" />);
      await waitFor(() => {
        expect(screen.getByText(/🟢 高置信 85%/)).toBeInTheDocument();
      });
      expect(screen.getByText('多维度数据一致，参考价值较高')).toBeInTheDocument();
    });

    it('shows 🟡中置信 for confidence 60-79', async () => {
      mockGetAnalysis.mockResolvedValue(makeAnalysis({ confidence: 70 }));
      render(<AnalysisPanel stockCode="600000" />);
      await waitFor(() => {
        expect(screen.getByText(/🟡 中置信 70%/)).toBeInTheDocument();
      });
      expect(screen.getByText('部分数据支撑，仅供参考')).toBeInTheDocument();
    });

    it('shows 🔴低置信 for confidence < 60', async () => {
      mockGetAnalysis.mockResolvedValue(makeAnalysis({ confidence: 45 }));
      render(<AnalysisPanel stockCode="600000" />);
      await waitFor(() => {
        expect(screen.getByText(/🔴 低置信 45%/)).toBeInTheDocument();
      });
      expect(screen.getByText('数据不足或矛盾，谨慎参考')).toBeInTheDocument();
    });
  });

  it('expands reasoning on click', async () => {
    const user = userEvent.setup();
    mockGetAnalysis.mockResolvedValue(makeAnalysis());
    render(<AnalysisPanel stockCode="600000" />);

    await waitFor(() => {
      expect(screen.getByText(/🟢 高置信/)).toBeInTheDocument();
    });

    expect(screen.queryByText('推理过程')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '展开推理过程' }));

    expect(screen.getByText('推理过程')).toBeInTheDocument();
    expect(screen.getByText('技术面多头排列，基本面稳健，短期看多。')).toBeInTheDocument();
  });

  it('renders key signals', async () => {
    mockGetAnalysis.mockResolvedValue(makeAnalysis());
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('关键信号')).toBeInTheDocument();
    });
    expect(screen.getByText('• MACD金叉')).toBeInTheDocument();
    expect(screen.getByText('• 量价配合良好')).toBeInTheDocument();
  });

  it('renders action reference', async () => {
    mockGetAnalysis.mockResolvedValue(makeAnalysis({ actionRef: 'hold' }));
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('操作参考方案')).toBeInTheDocument();
    });
    expect(screen.getByText('持有')).toBeInTheDocument();
  });

  it('renders target price', async () => {
    mockGetAnalysis.mockResolvedValue(makeAnalysis());
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('目标价位')).toBeInTheDocument();
    });
    expect(screen.getByText('14.00 - 16.50')).toBeInTheDocument();
  });

  it('renders profit estimate', async () => {
    mockGetAnalysis.mockResolvedValue(makeAnalysis());
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('收益参考预估')).toBeInTheDocument();
    });
    expect(screen.getByText('按当前趋势，持有30天预计收益区间5%-12%')).toBeInTheDocument();
  });

  it('renders recovery estimate when present as plain text', async () => {
    mockGetAnalysis.mockResolvedValue(makeAnalysis({
      recoveryEstimate: '预计2-4周可能回本',
    }));
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('回本参考预估')).toBeInTheDocument();
    });
    expect(screen.getByText('预计2-4周可能回本')).toBeInTheDocument();
  });

  it('renders recovery estimate from JSON format with note field', async () => {
    const jsonEstimate = JSON.stringify({
      estimatedDays: [11, 18],
      confidence: 50,
      note: '参考预估：预计2-3周可能回本（仅供参考，实际走势受多种因素影响）',
    });
    mockGetAnalysis.mockResolvedValue(makeAnalysis({
      recoveryEstimate: jsonEstimate,
    }));
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('回本参考预估')).toBeInTheDocument();
    });
    expect(screen.getByText(/参考预估：预计2-3周可能回本/)).toBeInTheDocument();
  });

  it('renders position strategy with profit/base positions', async () => {
    mockGetAnalysis.mockResolvedValue(makeAnalysis());
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('分仓操作方案')).toBeInTheDocument();
    });
    expect(screen.getByText('利润仓 (30%)')).toBeInTheDocument();
    expect(screen.getByText('可考虑减仓锁定利润')).toBeInTheDocument();
    expect(screen.getByText('底仓 (70%)')).toBeInTheDocument();
    expect(screen.getByText('继续持有')).toBeInTheDocument();
  });

  it('renders batch plan', async () => {
    mockGetAnalysis.mockResolvedValue(makeAnalysis());
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('分批方案')).toBeInTheDocument();
    });
    expect(screen.getByText('卖出 300股')).toBeInTheDocument();
    expect(screen.getByText('目标价 15.00')).toBeInTheDocument();
    expect(screen.getByText('锁定部分利润')).toBeInTheDocument();
  });

  it('renders risk alerts with ⚠️ icon', async () => {
    mockGetAnalysis.mockResolvedValue(makeAnalysis());
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('⚠️ 量价背离，警惕主力出货')).toBeInTheDocument();
    });
  });

  it('renders disclaimer text', async () => {
    mockGetAnalysis.mockResolvedValue(makeAnalysis());
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('以上内容仅供参考，不构成投资依据')).toBeInTheDocument();
    });
  });

  it('renders TechnicalIndicators component', async () => {
    mockGetAnalysis.mockResolvedValue(makeAnalysis());
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('技术指标信号')).toBeInTheDocument();
    });
  });

  it('hides optional sections when data is absent', async () => {
    mockGetAnalysis.mockResolvedValue(makeAnalysis({
      targetPrice: undefined,
      recoveryEstimate: null,
      profitEstimate: null,
      positionStrategy: undefined,
      batchPlan: [],
      riskAlerts: [],
      keySignals: [],
    }));
    render(<AnalysisPanel stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('上升阶段')).toBeInTheDocument();
    });
    expect(screen.queryByText('目标价位')).not.toBeInTheDocument();
    expect(screen.queryByText('回本参考预估')).not.toBeInTheDocument();
    expect(screen.queryByText('收益参考预估')).not.toBeInTheDocument();
    expect(screen.queryByText('分仓操作方案')).not.toBeInTheDocument();
    expect(screen.queryByText('分批方案')).not.toBeInTheDocument();
    expect(screen.queryByText('关键信号')).not.toBeInTheDocument();
  });
});
