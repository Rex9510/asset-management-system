import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StockCard from './StockCard';
import { Position } from '../api/positions';

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
    expect(screen.getByText('12.50')).toBeInTheDocument();
    expect(screen.getByText('持仓')).toBeInTheDocument();
    expect(screen.getByText('10.00')).toBeInTheDocument();
    expect(screen.getByText('1000')).toBeInTheDocument();
    expect(screen.getByText('30天')).toBeInTheDocument();
    expect(screen.getByText('+2500.00')).toBeInTheDocument();
    expect(screen.getAllByText('+25.00%').length).toBeGreaterThanOrEqual(1);
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
    expect(screen.getByText('关注')).toBeInTheDocument();
    expect(screen.queryByText('成本价')).not.toBeInTheDocument();
    expect(screen.queryByText('份额')).not.toBeInTheDocument();
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
