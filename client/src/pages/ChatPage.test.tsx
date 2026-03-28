import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import ChatPage from './ChatPage';

jest.mock('../api/chat', () => ({
  sendMessage: jest.fn(),
  getChatHistory: jest.fn(),
  evaluateCalmDown: jest.fn(),
}));

const chatApi = require('../api/chat') as {
  sendMessage: jest.Mock;
  getChatHistory: jest.Mock;
  evaluateCalmDown: jest.Mock;
};

const historyMessages = [
  { id: 1, userId: 1, role: 'user', content: '你好', stockCode: null, createdAt: '2024-01-01T10:00:00Z' },
  { id: 2, userId: 1, role: 'assistant', content: '你好！有什么可以帮你的？', stockCode: null, createdAt: '2024-01-01T10:00:05Z' },
];

function renderChatPage() {
  return render(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  chatApi.getChatHistory.mockResolvedValue(historyMessages);
  chatApi.sendMessage.mockResolvedValue({
    message: {
      id: 3, userId: 1, role: 'assistant', content: 'AI回复',
      stockCode: null, createdAt: '2024-01-01T10:01:00Z',
    },
    sellIntentDetected: false,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ChatPage', () => {
  it('loads and displays chat history on mount', async () => {
    await act(async () => { renderChatPage(); });
    await waitFor(() => {
      expect(screen.getByText('你好')).toBeInTheDocument();
      expect(screen.getByText('你好！有什么可以帮你的？')).toBeInTheDocument();
    });
    expect(chatApi.getChatHistory).toHaveBeenCalledWith(50);
  });

  it('shows empty state when no history', async () => {
    chatApi.getChatHistory.mockResolvedValue([]);
    await act(async () => { renderChatPage(); });
    await waitFor(() => {
      expect(screen.getByText(/发送消息开始对话/)).toBeInTheDocument();
    });
  });

  it('sends a message and displays AI response', async () => {
    await act(async () => { renderChatPage(); });
    await waitFor(() => expect(screen.getByText('你好')).toBeInTheDocument());

    const input = screen.getByLabelText('消息输入框');
    const sendBtn = screen.getByLabelText('发送消息');

    await act(async () => {
      fireEvent.change(input, { target: { value: '分析一下' } });
    });
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    // User message should appear optimistically
    expect(screen.getByText('分析一下')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('AI回复')).toBeInTheDocument();
    });
    expect(chatApi.sendMessage).toHaveBeenCalledWith('分析一下');
  });

  it('disables send button when input is empty', async () => {
    await act(async () => { renderChatPage(); });
    await waitFor(() => expect(screen.getByText('你好')).toBeInTheDocument());

    const sendBtn = screen.getByLabelText('发送消息');
    expect(sendBtn).toBeDisabled();
  });

  it('shows timeout error after 30 seconds', async () => {
    chatApi.sendMessage.mockImplementation(() => new Promise(() => {})); // never resolves
    await act(async () => { renderChatPage(); });
    await waitFor(() => expect(screen.getByText('你好')).toBeInTheDocument());

    const input = screen.getByLabelText('消息输入框');
    await act(async () => {
      fireEvent.change(input, { target: { value: '测试超时' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('发送消息'));
    });

    // Advance timer by 30 seconds
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(screen.getByRole('alert')).toHaveTextContent('分析超时，请稍后重试');
  });

  it('shows calm down dialog when sell intent detected', async () => {
    chatApi.sendMessage.mockResolvedValue({
      message: {
        id: 3, userId: 1, role: 'assistant', content: '让我帮你分析',
        stockCode: '601398', createdAt: '2024-01-01T10:01:00Z',
      },
      sellIntentDetected: true,
    });
    chatApi.evaluateCalmDown.mockResolvedValue({
      buyLogicReview: '买入逻辑回顾',
      sellJudgment: 'emotional',
      worstCaseEstimate: '最坏预估',
      recommendation: '参考方案',
    });

    await act(async () => { renderChatPage(); });
    await waitFor(() => expect(screen.getByText('你好')).toBeInTheDocument());

    const input = screen.getByLabelText('消息输入框');
    await act(async () => {
      fireEvent.change(input, { target: { value: '我想卖掉工商银行' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('发送消息'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('calm-down-dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('买入逻辑回顾')).toBeInTheDocument();
  });

  it('sends message on Enter key press', async () => {
    await act(async () => { renderChatPage(); });
    await waitFor(() => expect(screen.getByText('你好')).toBeInTheDocument());

    const input = screen.getByLabelText('消息输入框');
    await act(async () => {
      fireEvent.change(input, { target: { value: '回车发送' } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(screen.getByText('回车发送')).toBeInTheDocument();
    expect(chatApi.sendMessage).toHaveBeenCalledWith('回车发送');
  });
});
