import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SentimentTag from './SentimentTag';
import * as sentimentApi from '../api/sentiment';

jest.mock('../api/sentiment');

const mockGetSentiment = sentimentApi.getSentimentCurrent as jest.MockedFunction<typeof sentimentApi.getSentimentCurrent>;

const mockSentimentData: sentimentApi.SentimentData = {
  score: 48,
  label: '中性',
  emoji: '😐',
  components: {
    volumeRatio: 1.05,
    shChangePercent: 0.32,
    hs300ChangePercent: -0.15,
  },
  updatedAt: '2024-06-01T16:30:00.000Z',
};

describe('SentimentTag', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading placeholder initially', () => {
    mockGetSentiment.mockReturnValue(new Promise(() => {}));
    render(<SentimentTag />);
    expect(screen.getByTestId('sentiment-loading')).toHaveTextContent('情绪计算中...');
  });

  it('hides when API fails', async () => {
    mockGetSentiment.mockRejectedValue(new Error('Network error'));
    const { container } = render(<SentimentTag />);
    await waitFor(() => {
      expect(screen.queryByTestId('sentiment-loading')).not.toBeInTheDocument();
    });
    expect(container.innerHTML).toBe('');
  });

  it('hides when score is null', async () => {
    mockGetSentiment.mockResolvedValue({ score: null, message: '暂无情绪数据' });
    const { container } = render(<SentimentTag />);
    await waitFor(() => {
      expect(screen.queryByTestId('sentiment-loading')).not.toBeInTheDocument();
    });
    expect(container.innerHTML).toBe('');
  });

  it('renders sentiment tag with score and emoji', async () => {
    mockGetSentiment.mockResolvedValue(mockSentimentData);
    render(<SentimentTag />);
    await waitFor(() => {
      expect(screen.getByTestId('sentiment-tag')).toBeInTheDocument();
    });
    const tag = screen.getByTestId('sentiment-tag');
    expect(tag).toHaveTextContent('😐 情绪48');
  });

  it('renders fear tag with red color for low score', async () => {
    mockGetSentiment.mockResolvedValue({ ...mockSentimentData, score: 15, label: '极度恐慌', emoji: '😱' });
    render(<SentimentTag />);
    await waitFor(() => {
      expect(screen.getByTestId('sentiment-tag')).toBeInTheDocument();
    });
    expect(screen.getByTestId('sentiment-tag')).toHaveStyle({ color: '#ff4757' });
  });

  it('renders greed tag with green color for high score', async () => {
    mockGetSentiment.mockResolvedValue({ ...mockSentimentData, score: 65, label: '贪婪', emoji: '😊' });
    render(<SentimentTag />);
    await waitFor(() => {
      expect(screen.getByTestId('sentiment-tag')).toBeInTheDocument();
    });
    expect(screen.getByTestId('sentiment-tag')).toHaveStyle({ color: '#2ed573' });
  });

  it('opens SentimentGauge on click', async () => {
    mockGetSentiment.mockResolvedValue(mockSentimentData);
    render(<SentimentTag />);
    await waitFor(() => {
      expect(screen.getByTestId('sentiment-tag')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('sentiment-tag'));
    expect(screen.getByTestId('sentiment-gauge')).toBeInTheDocument();
  });

  it('closes SentimentGauge on tag toggle click', async () => {
    mockGetSentiment.mockResolvedValue(mockSentimentData);
    render(<SentimentTag />);
    await waitFor(() => {
      expect(screen.getByTestId('sentiment-tag')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('sentiment-tag'));
    expect(screen.getByTestId('sentiment-gauge')).toBeInTheDocument();

    // 再次点击标签关闭
    fireEvent.click(screen.getByTestId('sentiment-tag'));
    expect(screen.queryByTestId('sentiment-gauge')).not.toBeInTheDocument();
  });

  it('displays score circle in inline gauge', async () => {
    mockGetSentiment.mockResolvedValue(mockSentimentData);
    render(<SentimentTag />);
    await waitFor(() => {
      expect(screen.getByTestId('sentiment-tag')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('sentiment-tag'));

    // 内联面板显示分数和标签（中性出现在tag和gauge两处）
    expect(screen.getByText('48')).toBeInTheDocument();
    expect(screen.getAllByText('中性').length).toBeGreaterThanOrEqual(1);
  });

  it('displays sentiment bar labels in gauge', async () => {
    mockGetSentiment.mockResolvedValue(mockSentimentData);
    render(<SentimentTag />);
    await waitFor(() => {
      expect(screen.getByTestId('sentiment-tag')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('sentiment-tag'));

    expect(screen.getByText('极度恐慌')).toBeInTheDocument();
    expect(screen.getByText('极度贪婪')).toBeInTheDocument();
  });
});
