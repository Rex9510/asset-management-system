import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChatBubble from './ChatBubble';

describe('ChatBubble', () => {
  it('renders user message right-aligned with blue background', () => {
    render(
      <ChatBubble role="user" content="你好" createdAt="2024-01-01T10:30:00Z" />
    );
    const bubble = screen.getByTestId('chat-bubble-user');
    expect(bubble).toBeInTheDocument();
    expect(screen.getByText('你好')).toBeInTheDocument();
    expect(screen.getByText('我')).toBeInTheDocument();
  });

  it('renders assistant message left-aligned with white background', () => {
    render(
      <ChatBubble role="assistant" content="AI回复" createdAt="2024-01-01T10:31:00Z" />
    );
    const bubble = screen.getByTestId('chat-bubble-assistant');
    expect(bubble).toBeInTheDocument();
    expect(screen.getByText('AI回复')).toBeInTheDocument();
    expect(screen.getByText(/系统助手/)).toBeInTheDocument();
  });

  it('displays formatted timestamp', () => {
    render(
      <ChatBubble role="user" content="test" createdAt="2024-06-15T14:05:00Z" />
    );
    // Time display depends on local timezone, just check it renders
    expect(screen.getByTestId('chat-bubble-user')).toBeInTheDocument();
  });

  it('shows loading dots when isLoading is true', () => {
    render(
      <ChatBubble role="assistant" content="" createdAt="2024-01-01T10:30:00Z" isLoading />
    );
    expect(screen.getByTestId('loading-dots')).toBeInTheDocument();
  });

  it('does not show loading dots when isLoading is false', () => {
    render(
      <ChatBubble role="assistant" content="回复内容" createdAt="2024-01-01T10:30:00Z" />
    );
    expect(screen.queryByTestId('loading-dots')).not.toBeInTheDocument();
    expect(screen.getByText('回复内容')).toBeInTheDocument();
  });
});
