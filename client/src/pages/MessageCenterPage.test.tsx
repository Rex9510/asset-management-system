import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import MessageCenterPage from './MessageCenterPage';

jest.mock('../api/messages', () => ({
  getMessages: jest.fn(),
  getMessageDetail: jest.fn(),
  getUnreadCount: jest.fn().mockResolvedValue(0),
  getDailyPicks: jest.fn().mockResolvedValue([]),
}));

const messagesApi = require('../api/messages') as {
  getMessages: jest.Mock;
  getMessageDetail: jest.Mock;
};

const mockMessages = [
  {
    id: 1, userId: 1, type: 'target_price_alert', stockCode: '601398', stockName: '工商银行',
    summary: '接近目标价', detail: null, analysisId: null,
    isRead: false, createdAt: '2024-06-01T10:00:00Z',
  },
  {
    id: 2, userId: 1, type: 'ambush_recommendation', stockCode: '600036', stockName: '招商银行',
    summary: '低位埋伏推荐', detail: null, analysisId: null,
    isRead: true, createdAt: '2024-05-31T09:00:00Z',
  },
  {
    id: 3, userId: 1, type: 'scheduled_analysis', stockCode: '000001', stockName: '平安银行',
    summary: '定时分析完成', detail: null, analysisId: 10,
    isRead: false, createdAt: '2024-05-30T08:00:00Z',
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <MessageCenterPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  messagesApi.getMessages.mockResolvedValue({
    messages: mockMessages,
    total: 3,
    hasMore: false,
  });
  messagesApi.getMessageDetail.mockResolvedValue({
    id: 1, userId: 1, type: 'target_price_alert', stockCode: '601398', stockName: '工商银行',
    summary: '接近目标价', detail: '工商银行当前价格已达目标价90%，完整分析内容',
    analysisId: null, isRead: true, createdAt: '2024-06-01T10:00:00Z',
  });
});

describe('MessageCenterPage', () => {
  it('renders sticky header and filter tabs matching prototype', async () => {
    renderPage();
    expect(await screen.findByText('消息中心')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /全部/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /风险/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /市场/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /追踪/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /分析/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /机会/ })).toBeInTheDocument();
  });

  it('loads and displays messages on mount', async () => {
    renderPage();
    expect(await screen.findByText('接近目标价')).toBeInTheDocument();
    expect(screen.getByText('低位埋伏推荐')).toBeInTheDocument();
    expect(screen.getByText('定时分析完成')).toBeInTheDocument();
    expect(messagesApi.getMessages).toHaveBeenCalledWith({
      type: undefined,
      page: 1,
      limit: 20,
    });
  });

  it('shows type badges with correct labels', async () => {
    renderPage();
    await screen.findByText('接近目标价');
    expect(screen.getByText('🎯 目标价提醒')).toBeInTheDocument();
    expect(screen.getByText('🏹 埋伏推荐')).toBeInTheDocument();
    expect(screen.getByText('📊 定时分析')).toBeInTheDocument();
  });

  it('shows unread indicator on unread messages', async () => {
    renderPage();
    await screen.findByText('接近目标价');
    const dots = screen.getAllByTestId('unread-dot');
    expect(dots).toHaveLength(2);
  });

  it('filters messages by category when tab clicked', async () => {
    messagesApi.getMessages.mockImplementation(async (opts: { type?: string }) => {
      if (opts.type && opts.type.includes('target_price_alert')) {
        return { messages: [mockMessages[0]], total: 1, hasMore: false };
      }
      return { messages: mockMessages, total: 3, hasMore: false };
    });

    renderPage();
    await screen.findByText('接近目标价');

    fireEvent.click(screen.getByRole('tab', { name: /风险/ }));

    await waitFor(() => {
      expect(messagesApi.getMessages).toHaveBeenCalledWith({
        type: 'volatility_alert,stop_loss_alert,target_price_alert,concentration_risk',
        page: 1,
        limit: 20,
      });
    });
  });

  it('expands message detail on click', async () => {
    renderPage();
    await screen.findByText('接近目标价');

    // Click the first message card
    const cards = screen.getAllByRole('button');
    const targetCard = cards.find(c => c.textContent?.includes('接近目标价'));
    fireEvent.click(targetCard!);

    await waitFor(() => {
      expect(screen.getByTestId('message-detail')).toBeInTheDocument();
    });
    expect(messagesApi.getMessageDetail).toHaveBeenCalledWith(1);
    expect(await screen.findByText(/完整分析内容/)).toBeInTheDocument();
  });

  it('shows load more button when hasMore is true', async () => {
    messagesApi.getMessages.mockResolvedValue({
      messages: mockMessages,
      total: 40,
      hasMore: true,
    });

    renderPage();
    await screen.findByText('接近目标价');
    expect(screen.getByText('加载更多')).toBeInTheDocument();
  });

  it('loads more messages on button click', async () => {
    const page2Messages = [{
      id: 4, userId: 1, type: 'daily_pick', stockCode: '600000', stockName: '浦发银行',
      summary: '每日关注', detail: null, analysisId: null,
      isRead: true, createdAt: '2024-05-29T08:00:00Z',
    }];

    messagesApi.getMessages
      .mockResolvedValueOnce({ messages: mockMessages, total: 4, hasMore: true })
      .mockResolvedValueOnce({ messages: page2Messages, total: 4, hasMore: false });

    renderPage();
    await screen.findByText('接近目标价');

    fireEvent.click(screen.getByText('加载更多'));

    await waitFor(() => {
      expect(messagesApi.getMessages).toHaveBeenCalledWith({
        type: undefined,
        page: 2,
        limit: 20,
      });
    });
  });

  it('shows empty state when no messages', async () => {
    messagesApi.getMessages.mockResolvedValue({ messages: [], total: 0, hasMore: false });
    renderPage();
    expect(await screen.findByText('暂无消息')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    messagesApi.getMessages.mockRejectedValue(new Error('fail'));
    renderPage();
    expect(await screen.findByText('加载失败，请稍后重试')).toBeInTheDocument();
  });

  it('marks message as read locally after expanding', async () => {
    renderPage();
    await screen.findByText('接近目标价');

    expect(screen.getAllByTestId('unread-dot')).toHaveLength(2);

    const cards = screen.getAllByRole('button');
    const targetCard = cards.find(c => c.textContent?.includes('接近目标价'));
    fireEvent.click(targetCard!);

    await waitFor(() => {
      expect(screen.getByTestId('message-detail')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('unread-dot')).toHaveLength(1);
    });
  });
});
