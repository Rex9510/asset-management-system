/**
 * SentimentGauge 交互测试
 * Task 28.1
 */
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SentimentGauge from './SentimentGauge';
import { SentimentData } from '../api/sentiment';

function makeSentiment(overrides: Partial<SentimentData> = {}): SentimentData {
  return {
    score: 48,
    label: '中性',
    emoji: '😐',
    components: {
      volumeRatio: 1.05,
      shChangePercent: 0.35,
      hs300ChangePercent: -0.12,
    },
    updatedAt: '2025-06-01T16:30:00Z',
    ...overrides,
  };
}

describe('SentimentGauge', () => {
  it('renders score, label, and emoji', () => {
    render(<SentimentGauge data={makeSentiment()} onClose={jest.fn()} />);
    expect(screen.getByText('48')).toBeInTheDocument();
    expect(screen.getByText('中性')).toBeInTheDocument();
    expect(screen.getByText('😐')).toBeInTheDocument();
  });

  it('renders component breakdown', () => {
    render(<SentimentGauge data={makeSentiment()} onClose={jest.fn()} />);
    expect(screen.getByText('成交量/均量比')).toBeInTheDocument();
    expect(screen.getByText('1.05')).toBeInTheDocument();
    expect(screen.getByText('上证涨跌幅')).toBeInTheDocument();
    expect(screen.getByText('+0.35%')).toBeInTheDocument();
    expect(screen.getByText('沪深300涨跌幅')).toBeInTheDocument();
    expect(screen.getByText('-0.12%')).toBeInTheDocument();
  });

  it('renders gauge labels', () => {
    render(<SentimentGauge data={makeSentiment()} onClose={jest.fn()} />);
    expect(screen.getByText('😱 恐慌')).toBeInTheDocument();
    expect(screen.getByText('贪婪 🤑')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = jest.fn();
    render(<SentimentGauge data={makeSentiment()} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay clicked', () => {
    const onClose = jest.fn();
    render(<SentimentGauge data={makeSentiment()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('sentiment-gauge-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when panel content clicked', () => {
    const onClose = jest.fn();
    render(<SentimentGauge data={makeSentiment()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('sentiment-gauge'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders extreme fear state correctly', () => {
    render(<SentimentGauge data={makeSentiment({ score: 15, label: '极度恐慌', emoji: '😱' })} onClose={jest.fn()} />);
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('极度恐慌')).toBeInTheDocument();
    expect(screen.getAllByText('😱').length).toBeGreaterThanOrEqual(1);
  });

  it('renders extreme greed state correctly', () => {
    render(<SentimentGauge data={makeSentiment({ score: 85, label: '极度贪婪', emoji: '🤑' })} onClose={jest.fn()} />);
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('极度贪婪')).toBeInTheDocument();
    expect(screen.getAllByText('🤑').length).toBeGreaterThanOrEqual(1);
  });

  it('shows updated time', () => {
    render(<SentimentGauge data={makeSentiment()} onClose={jest.fn()} />);
    expect(screen.getByText(/更新于/)).toBeInTheDocument();
  });
});
