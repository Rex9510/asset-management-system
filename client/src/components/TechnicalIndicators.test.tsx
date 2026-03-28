import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import TechnicalIndicators from './TechnicalIndicators';
import * as analysisApi from '../api/analysis';

jest.mock('../api/analysis');

const mockGetIndicators = analysisApi.getIndicators as jest.MockedFunction<typeof analysisApi.getIndicators>;
const mockGetRiskAlerts = analysisApi.getRiskAlerts as jest.MockedFunction<typeof analysisApi.getRiskAlerts>;

function makeIndicators(overrides: Partial<analysisApi.IndicatorData> = {}): analysisApi.IndicatorData {
  return {
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
      rsi: { direction: 'bearish', label: 'RSI超卖区间' },
    },
    updatedAt: '2024-06-01T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TechnicalIndicators', () => {
  it('shows loading state initially', () => {
    mockGetIndicators.mockReturnValue(new Promise(() => {}));
    mockGetRiskAlerts.mockReturnValue(new Promise(() => {}));
    render(<TechnicalIndicators stockCode="600000" />);
    expect(screen.getByText('指标计算中...')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    mockGetIndicators.mockRejectedValue(new Error('fail'));
    mockGetRiskAlerts.mockResolvedValue([]);
    render(<TechnicalIndicators stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('指标数据暂不可用')).toBeInTheDocument();
    });
  });

  it('renders signal lights with correct emojis and labels', async () => {
    mockGetIndicators.mockResolvedValue(makeIndicators());
    mockGetRiskAlerts.mockResolvedValue([]);
    render(<TechnicalIndicators stockCode="600000" />);

    await waitFor(() => {
      expect(screen.getByText('技术指标信号')).toBeInTheDocument();
    });

    // Bullish signals: 🟢看多
    expect(screen.getAllByText('🟢').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('看多').length).toBe(2); // MA and MACD

    // Neutral signal: 🟡震荡
    expect(screen.getAllByText('🟡').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('震荡')).toBeInTheDocument();

    // Bearish signal: 🔴看空
    expect(screen.getAllByText('🔴').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('看空')).toBeInTheDocument();
  });

  it('renders one-line explanation for each signal', async () => {
    mockGetIndicators.mockResolvedValue(makeIndicators());
    mockGetRiskAlerts.mockResolvedValue([]);
    render(<TechnicalIndicators stockCode="600000" />);

    await waitFor(() => {
      expect(screen.getByText('多头排列，短期看多')).toBeInTheDocument();
    });
    expect(screen.getByText('MACD金叉，短期看多')).toBeInTheDocument();
    expect(screen.getByText('KDJ中性震荡')).toBeInTheDocument();
    expect(screen.getByText('RSI超卖区间')).toBeInTheDocument();
  });

  it('renders indicator names (MA均线, MACD, KDJ, RSI)', async () => {
    mockGetIndicators.mockResolvedValue(makeIndicators());
    mockGetRiskAlerts.mockResolvedValue([]);
    render(<TechnicalIndicators stockCode="600000" />);

    await waitFor(() => {
      expect(screen.getByText('MA均线')).toBeInTheDocument();
    });
    expect(screen.getByText('MACD')).toBeInTheDocument();
    expect(screen.getByText('KDJ')).toBeInTheDocument();
    expect(screen.getByText('RSI')).toBeInTheDocument();
  });

  it('renders risk alerts with ⚠️ orange warning', async () => {
    mockGetIndicators.mockResolvedValue(makeIndicators());
    mockGetRiskAlerts.mockResolvedValue([
      {
        type: 'volume_divergence',
        level: 'warning',
        label: '量价背离，警惕主力出货',
        explanation: '成交量放大但股价未涨',
      },
    ]);
    render(<TechnicalIndicators stockCode="600000" />);

    await waitFor(() => {
      expect(screen.getByText('⚠️ 量价背离，警惕主力出货')).toBeInTheDocument();
    });
  });

  it('hides raw values by default and shows on toggle', async () => {
    const user = userEvent.setup();
    mockGetIndicators.mockResolvedValue(makeIndicators());
    mockGetRiskAlerts.mockResolvedValue([]);
    render(<TechnicalIndicators stockCode="600000" />);

    await waitFor(() => {
      expect(screen.getByText('查看原始数值 ▼')).toBeInTheDocument();
    });

    // Raw values should not be visible
    expect(screen.queryByText(/MA5:/)).not.toBeInTheDocument();

    // Click to expand
    await user.click(screen.getByRole('button', { name: '展开原始数值' }));

    expect(screen.getByText(/MA5: 12.50/)).toBeInTheDocument();
    expect(screen.getByText(/MA10: 12.30/)).toBeInTheDocument();
    expect(screen.getByText(/MA20: 12.00/)).toBeInTheDocument();
    expect(screen.getByText(/MA60: 11.50/)).toBeInTheDocument();
    expect(screen.getByText(/DIF: 0.15/)).toBeInTheDocument();
    expect(screen.getByText(/DEA: 0.10/)).toBeInTheDocument();
    expect(screen.getByText(/K: 65.00/)).toBeInTheDocument();
    expect(screen.getByText(/RSI6: 58.00/)).toBeInTheDocument();
  });

  it('collapses raw values on second toggle', async () => {
    const user = userEvent.setup();
    mockGetIndicators.mockResolvedValue(makeIndicators());
    mockGetRiskAlerts.mockResolvedValue([]);
    render(<TechnicalIndicators stockCode="600000" />);

    await waitFor(() => {
      expect(screen.getByText('查看原始数值 ▼')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '展开原始数值' }));
    expect(screen.getByText(/MA5: 12.50/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '收起原始数值' }));
    expect(screen.queryByText(/MA5: 12.50/)).not.toBeInTheDocument();
  });

  it('does not render risk section when no alerts', async () => {
    mockGetIndicators.mockResolvedValue(makeIndicators());
    mockGetRiskAlerts.mockResolvedValue([]);
    render(<TechnicalIndicators stockCode="600000" />);

    await waitFor(() => {
      expect(screen.getByText('技术指标信号')).toBeInTheDocument();
    });
    expect(screen.queryByText(/⚠️/)).not.toBeInTheDocument();
  });

  it('renders multiple risk alerts', async () => {
    mockGetIndicators.mockResolvedValue(makeIndicators());
    mockGetRiskAlerts.mockResolvedValue([
      { type: 'volume_divergence', level: 'warning', label: '量价背离', explanation: '' },
      { type: 'late_spike', level: 'danger', label: '尾盘异动', explanation: '' },
    ]);
    render(<TechnicalIndicators stockCode="600000" />);

    await waitFor(() => {
      expect(screen.getByText('⚠️ 量价背离')).toBeInTheDocument();
    });
    expect(screen.getByText('⚠️ 尾盘异动')).toBeInTheDocument();
  });
});
