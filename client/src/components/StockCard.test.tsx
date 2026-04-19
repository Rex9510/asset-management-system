import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StockCard from './StockCard';
import { Position } from '../api/positions';

// Mock dependencies to avoid API calls
jest.mock('./ValuationTag', () => {
  return function MockValuationTag({ stockCode }: { stockCode: string }) {
    return <span data-testid="valuation-tag">估值-{stockCode}</span>;
  };
});
jest.mock('./StopLossIndicator', () => {
  return function MockStopLoss() { return <span data-testid="stoploss">止损</span>; };
});
jest.mock('./DeepReportModal', () => {
  return function MockDeepReport() { return null; };
});
jest.mock('./BacktestPanel', () => {
  return function MockBacktest() { return null; };
});
jest.mock('../api/analysis', () => ({
  getAnalysis: jest.fn().mockResolvedValue(null),
  triggerAnalysis: jest.fn().mockResolvedValue(null),
  getIndicators: jest.fn().mockRejectedValue(new Error('no data')),
}));
jest.mock('../api/deepAnalysis', () => ({
  startDeepReport: jest.fn().mockResolvedValue({ reportId: 1 }),
}));

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 1,
    userId: 1,
    stockCode: '600000',
    stockName: '浦发银行',
    positionType: 'holding',
    costPrice: 10.0,
    shares: 1000,
    buyDate: '2024-01-01',
    currentPrice: 12.5,
    profitLoss: 2500,
    profitLossPercent: 25,
    holdingDays: 30,
    changePercent: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('StockCard', () => {
  it('renders holding card with all fields', () => {
    render(<StockCard position={makePosition()} />);
    expect(screen.getByText('浦发银行')).toBeInTheDocument();
    expect(screen.getByText('600000')).toBeInTheDocument();
    // Price displayed with locale formatting
    expect(screen.getByText('12.50')).toBeInTheDocument();
    // Info grid: cost, shares, P&L
    expect(screen.getByText('成本价')).toBeInTheDocument();
    expect(screen.getByText('10.00')).toBeInTheDocument();
    expect(screen.getByText('1000股')).toBeInTheDocument();
    expect(screen.getByText('+2500.00')).toBeInTheDocument();
    expect(screen.getAllByText('+25.00%').length).toBeGreaterThanOrEqual(1);
    // Holding duration
    expect(screen.getByText('30天')).toBeInTheDocument();
    // Deep report & backtest buttons for holding mode
    expect(screen.getByText('📋 生成深度报告')).toBeInTheDocument();
    expect(screen.getByText('📈 历史回测')).toBeInTheDocument();
  });

  it('renders watching card without P&L info', () => {
    render(<StockCard position={makePosition({
      positionType: 'watching',
      costPrice: null,
      shares: null,
      buyDate: null,
      profitLoss: null,
      profitLossPercent: null,
      holdingDays: null,
    })} />);
    expect(screen.getByText('浦发银行')).toBeInTheDocument();
    // No info grid for watching
    expect(screen.queryByText('成本价')).not.toBeInTheDocument();
    expect(screen.queryByText('持有')).not.toBeInTheDocument();
    // Watching mode has buy, deep report, backtest, unwatch buttons
    expect(screen.getByText('🛒 买入建仓')).toBeInTheDocument();
    expect(screen.getByText('📋 深度报告')).toBeInTheDocument();
    expect(screen.getByText('📈 历史回测')).toBeInTheDocument();
    expect(screen.getByText('取消关注')).toBeInTheDocument();
  });

  it('shows daily change percent when quote change is available', () => {
    render(<StockCard position={makePosition({
      positionType: 'watching',
      costPrice: null,
      shares: null,
      buyDate: null,
      profitLoss: null,
      profitLossPercent: null,
      holdingDays: null,
      changePercent: 1.23,
    })} />);

    expect(screen.getByText('+1.23%')).toBeInTheDocument();
  });

  it('shows -- when currentPrice is null', () => {
    render(<StockCard position={makePosition({ currentPrice: null })} />);
    const dashes = screen.getAllByText('--');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('renders negative P&L correctly', () => {
    render(<StockCard position={makePosition({
      currentPrice: 8.0,
      profitLoss: -2000,
      profitLossPercent: -20,
    })} />);
    expect(screen.getByText('-2000.00')).toBeInTheDocument();
    expect(screen.getAllByText('-20.00%').length).toBeGreaterThanOrEqual(1);
  });
});
