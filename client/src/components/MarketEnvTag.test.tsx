import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import MarketEnvTag from './MarketEnvTag';
import * as marketEnvApi from '../api/marketEnv';

jest.mock('../api/marketEnv');

const mockGetMarketEnv = marketEnvApi.getMarketEnv as jest.MockedFunction<typeof marketEnvApi.getMarketEnv>;

const baseIndicators = {
  shIndex: { ma20Trend: 'up', ma60Trend: 'down' },
  hs300: { ma20Trend: 'up', ma60Trend: 'down' },
  volumeChange: 1.2,
  advanceDeclineRatio: 1.6,
};

describe('MarketEnvTag', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading placeholder initially', () => {
    mockGetMarketEnv.mockReturnValue(new Promise(() => {}));
    render(<MarketEnvTag />);
    expect(screen.getByTestId('marketenv-loading')).toHaveTextContent('大盘计算中...');
  });

  it('hides when API fails', async () => {
    mockGetMarketEnv.mockRejectedValue(new Error('Network error'));
    const { container } = render(<MarketEnvTag />);
    await waitFor(() => {
      expect(screen.queryByTestId('marketenv-loading')).not.toBeInTheDocument();
    });
    expect(container.innerHTML).toBe('');
  });

  it('renders bull market tag with green color', async () => {
    mockGetMarketEnv.mockResolvedValue({
      environment: 'bull',
      label: '牛市 🐂',
      confidenceAdjust: 0,
      riskTip: null,
      indicators: baseIndicators,
      updatedAt: '2024-01-01T00:00:00Z',
    });
    render(<MarketEnvTag />);
    await waitFor(() => {
      expect(screen.getByTestId('marketenv-tag')).toBeInTheDocument();
    });
    const tag = screen.getByTestId('marketenv-tag');
    expect(tag).toHaveTextContent('牛市 🐂');
    expect(tag).toHaveStyle({ color: '#2ed573' });
  });

  it('renders sideways market tag with blue color', async () => {
    mockGetMarketEnv.mockResolvedValue({
      environment: 'sideways',
      label: '震荡 ⚖️',
      confidenceAdjust: 0,
      riskTip: null,
      indicators: baseIndicators,
      updatedAt: '2024-01-01T00:00:00Z',
    });
    render(<MarketEnvTag />);
    await waitFor(() => {
      expect(screen.getByTestId('marketenv-tag')).toBeInTheDocument();
    });
    const tag = screen.getByTestId('marketenv-tag');
    expect(tag).toHaveTextContent('震荡 ⚖️');
    expect(tag).toHaveStyle({ color: '#ffa502' });
  });

  it('renders bear market tag with red color and risk tip', async () => {
    mockGetMarketEnv.mockResolvedValue({
      environment: 'bear',
      label: '熊市 🐻',
      confidenceAdjust: -15,
      riskTip: '当前大盘处于熊市环境，操作需谨慎',
      indicators: baseIndicators,
      updatedAt: '2024-01-01T00:00:00Z',
    });
    render(<MarketEnvTag />);
    await waitFor(() => {
      expect(screen.getByTestId('marketenv-tag')).toBeInTheDocument();
    });
    const tag = screen.getByTestId('marketenv-tag');
    expect(tag).toHaveTextContent('熊市 🐻');
    expect(tag).toHaveStyle({ color: '#ff4757' });
    expect(screen.getByTestId('marketenv-risk-tip')).toHaveTextContent('当前大盘处于熊市环境，操作需谨慎');
  });

  it('does not show risk tip for non-bear environments', async () => {
    mockGetMarketEnv.mockResolvedValue({
      environment: 'sideways',
      label: '震荡 ⚖️',
      confidenceAdjust: 0,
      riskTip: null,
      indicators: baseIndicators,
      updatedAt: '2024-01-01T00:00:00Z',
    });
    render(<MarketEnvTag />);
    await waitFor(() => {
      expect(screen.getByTestId('marketenv-tag')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('marketenv-risk-tip')).not.toBeInTheDocument();
  });
});
