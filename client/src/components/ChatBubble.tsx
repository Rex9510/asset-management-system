import React from 'react';

export interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  isLoading?: boolean;
}

const ChatBubble: React.FC<ChatBubbleProps> = ({ role, content, createdAt, isLoading }) => {
  const isUser = role === 'user';

  const formatTime = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      const h = date.getHours().toString().padStart(2, '0');
      const m = date.getMinutes().toString().padStart(2, '0');
      return `${h}:${m}`;
    } catch {
      return '';
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: '14px',
        padding: '0 14px',
        animation: 'fadeIn 0.25s ease',
      }}
      data-testid={`chat-bubble-${role}`}
    >
      <div style={styles.roleLabel}>
        {isUser ? '我' : '🤖 系统助手'}
      </div>
      <div
        style={{
          ...styles.bubble,
          background: isUser ? 'linear-gradient(135deg, #667eea, #764ba2)' : 'rgba(255,255,255,0.95)',
          color: isUser ? '#fff' : '#1a1a2e',
          borderTopRightRadius: isUser ? '4px' : '18px',
          borderTopLeftRadius: isUser ? '18px' : '4px',
          boxShadow: isUser ? '0 4px 12px rgba(102,126,234,0.25)' : '0 2px 12px rgba(0,0,0,0.06)',
        }}
      >
        {isLoading ? (
          <span style={styles.loadingDots} data-testid="loading-dots">
            <span style={styles.dot}>●</span>
            <span style={{ ...styles.dot, animationDelay: '0.2s' }}>●</span>
            <span style={{ ...styles.dot, animationDelay: '0.4s' }}>●</span>
          </span>
        ) : (
          <span style={styles.content}>{content}</span>
        )}
      </div>
      <div style={styles.timestamp}>{formatTime(createdAt)}</div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  roleLabel: {
    fontSize: '12px',
    color: '#8b8fa3',
    marginBottom: '4px',
    fontWeight: 500,
  },
  bubble: {
    maxWidth: '80%',
    padding: '12px 16px',
    borderRadius: '18px',
    fontSize: '14px',
    lineHeight: '1.6',
    wordBreak: 'break-word' as const,
  },
  content: {
    whiteSpace: 'pre-wrap' as const,
  },
  timestamp: {
    fontSize: '12px',
    color: '#c0c4cc',
    marginTop: '4px',
  },
  loadingDots: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
  },
  dot: {
    fontSize: '12px',
    opacity: 0.4,
    animation: 'pulse 1.2s ease-in-out infinite',
  },
};

export default ChatBubble;
