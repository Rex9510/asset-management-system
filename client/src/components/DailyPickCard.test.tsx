import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import DailyPickCard from './DailyPickCard';
import { DailyPickMessage } from '../api/messages';

function makePickMessage(overrides: Partial<DailyPickMessage> = {}): DailyPickMessage {
  return {
    id: 1,
    stockCode: '600000',
    stockName: '浦发银行',
    summary: '每日关注',
    detail: JSON.stringify({
      picks: [
        {
          stockCode: '600000',
          stockName: '浦发银行',
          cycle: 'short',
          reason: 'MACD金叉，短期看多',
          targetPriceRange: { low: 10, high: 12 },
          upsidePercent: 15,
          reasoning: '详细推理过程：技术面MACD金叉确认...',
        },
      ],
    }),
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('DailyPickCard', () => {
  it('renders pick card with stock info and cycle tag', () => {
    render(<DailyPickCard message={makePickMessage()} />);
    expect(screen.getByText('浦发银行')).toBeInTheDocument();
    expect(screen.getByText('600000')).toBeInTheDocument();
    expect(screen.getByText('短期')).toBeInTheDocument();
  });

  it('shows reason, target price, and upside', () => {
    render(<DailyPickCard message={makePickMessage()} />);
    expect(screen.getByText(/MACD金叉/)).toBeInTheDocument();
    expect(screen.getByText('10.00 - 12.00')).toBeInTheDocument();
    expect(screen.getByText('+15.0%')).toBeInTheDocument();
  });

  it('shows compliance disclaimer', () => {
    render(<DailyPickCard message={makePickMessage()} />);
    expect(screen.getByText(/仅供参考/)).toBeInTheDocument();
  });

  it('expands reasoning on click', () => {
    render(<DailyPickCard message={makePickMessage()} />);
    expect(screen.queryByText(/详细推理过程/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('查看详情 ▼'));
    expect(screen.getByText(/详细推理过程/)).toBeInTheDocument();
  });

  it('collapses reasoning on second click', () => {
    render(<DailyPickCard message={makePickMessage()} />);
    fireEvent.click(screen.getByText('查看详情 ▼'));
    expect(screen.getByText(/详细推理过程/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('收起详情 ▲'));
    expect(screen.queryByText(/详细推理过程/)).not.toBeInTheDocument();
  });

  it('renders nothing for invalid detail JSON', () => {
    const { container } = render(<DailyPickCard message={makePickMessage({ detail: 'invalid' })} />);
    expect(container.firstChild).toBeNull();
  });
});
