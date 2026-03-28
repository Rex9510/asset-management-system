import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StopLossIndicator from './StopLossIndicator';

describe('StopLossIndicator', () => {
  it('shows normal stop loss line when not triggered', () => {
    render(<StopLossIndicator stopLossPrice={9.0} currentPrice={12.5} />);
    expect(screen.getByText('止损线 9.00')).toBeInTheDocument();
  });

  it('shows triggered warning when current price <= stop loss', () => {
    render(<StopLossIndicator stopLossPrice={10.0} currentPrice={9.5} />);
    expect(screen.getByText('⚠️ 已触发止损 10.00')).toBeInTheDocument();
  });

  it('shows triggered when current price equals stop loss', () => {
    render(<StopLossIndicator stopLossPrice={10.0} currentPrice={10.0} />);
    expect(screen.getByText('⚠️ 已触发止损 10.00')).toBeInTheDocument();
  });

  it('shows normal when current price is null', () => {
    render(<StopLossIndicator stopLossPrice={9.0} currentPrice={null} />);
    expect(screen.getByText('止损线 9.00')).toBeInTheDocument();
  });

  it('has correct aria-label for triggered state', () => {
    render(<StopLossIndicator stopLossPrice={10.0} currentPrice={8.0} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '已触发止损 10');
  });

  it('has correct aria-label for normal state', () => {
    render(<StopLossIndicator stopLossPrice={9.0} currentPrice={12.0} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '止损线 9');
  });

  it('applies red style when triggered', () => {
    render(<StopLossIndicator stopLossPrice={10.0} currentPrice={8.0} />);
    const tag = screen.getByRole('status');
    expect(tag).toHaveStyle({ color: '#ff4d4f' });
  });

  it('applies normal style when not triggered', () => {
    render(<StopLossIndicator stopLossPrice={9.0} currentPrice={12.0} />);
    const tag = screen.getByRole('status');
    expect(tag).toHaveStyle({ color: '#8b8fa3' });
  });
});
