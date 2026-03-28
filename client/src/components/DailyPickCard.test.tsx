import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import DailyPickCard from './DailyPickCard';
import { DailyPickMessage } from '../api/messages';

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn().mockRejectedValue(new Error('no quote')) },
}));

jest.mock('./ValuationTag', () => ({
  __esModule: true,
  default: () => <span data-testid="valuation-tag">ValuationTag</span>,
}));

function makePickMessage(overrides: Partial<DailyPickMessage> = {}): DailyPickMessage {
  return {
    id: 1,
    stockCode: '600000',
    stockName: '浦发银行',
    summary: '【短期关注(1-2周)】浦发银行(600000) 目标价10-12元',
    detail: JSON.stringify({
      stockCode: '600000',
      stockName: '浦发银行',
      period: 'short',
      periodLabel: '短期关注(1-2周)',
      reason: 'MACD金叉，短期看多。技术面MACD金叉确认，基本面估值偏低。',
      targetPriceRange: { low: 10, high: 12 },
      estimatedUpside: 15,
      confidence: 75,
    }),
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('DailyPickCard', () => {
  it('renders pick card with stock info and period tag', () => {
    render(<DailyPickCard message={makePickMessage()} />);
    expect(screen.getByText('浦发银行')).toBeInTheDocument();
    expect(screen.getByText('600000')).toBeInTheDocument();
    expect(screen.getByText('短期关注(1-2周)')).toBeInTheDocument();
  });

  it('shows target price and upside', () => {
    render(<DailyPickCard message={makePickMessage()} />);
    expect(screen.getByText('10 - 12')).toBeInTheDocument();
    expect(screen.getByText('+15.0%')).toBeInTheDocument();
  });

  it('shows action buttons', () => {
    render(<DailyPickCard message={makePickMessage()} />);
    expect(screen.getByText(/加入关注/)).toBeInTheDocument();
    expect(screen.getByText(/快速买入/)).toBeInTheDocument();
  });

  it('shows confidence badge', () => {
    render(<DailyPickCard message={makePickMessage()} />);
    expect(screen.getByText(/中置信 75%/)).toBeInTheDocument();
  });

  it('shows view analysis link', () => {
    render(<DailyPickCard message={makePickMessage()} />);
    expect(screen.getByText('查看完整分析 ›')).toBeInTheDocument();
  });

  it('renders nothing for invalid detail JSON', () => {
    const { container } = render(<DailyPickCard message={makePickMessage({ detail: 'invalid' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows valuation tag', () => {
    render(<DailyPickCard message={makePickMessage()} />);
    expect(screen.getByTestId('valuation-tag')).toBeInTheDocument();
  });
});
