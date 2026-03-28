import React, { useState, useEffect, useCallback, useRef } from 'react';
import ChatBubble from '../components/ChatBubble';
import CalmDownDialog from '../components/CalmDownDialog';
import {
  ChatMessage,
  CalmDownEvaluation,
  sendMessage,
  getChatHistory,
  evaluateCalmDown,
} from '../api/chat';

const TIMEOUT_MS = 30000;

const ChatPage: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [calmDownEval, setCalmDownEval] = useState<CalmDownEvaluation | null>(null);
  const [timeoutError, setTimeoutError] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  // Load history on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const history = await getChatHistory(50);
        if (!cancelled) {
          setMessages(history);
        }
      } catch {
        // silently ignore
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || loading) return;

    setInputText('');
    setTimeoutError(false);

    // Optimistically add user message
    const userMsg: ChatMessage = {
      id: Date.now(),
      userId: 0,
      role: 'user',
      content: text,
      stockCode: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    // Set 30s timeout
    timeoutRef.current = setTimeout(() => {
      setLoading(false);
      setTimeoutError(true);
    }, TIMEOUT_MS);

    try {
      const response = await sendMessage(text);

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;

      setLoading(false);

      // Add AI response with progressive display
      const aiMsg = response.message;
      setMessages((prev) => [...prev, aiMsg]);

      // If sell intent detected, trigger calm down evaluation
      if (response.sellIntentDetected && aiMsg.stockCode) {
        try {
          const evaluation = await evaluateCalmDown(aiMsg.stockCode);
          setCalmDownEval(evaluation);
        } catch {
          // silently ignore calm down errors
        }
      }
    } catch {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setLoading(false);
      // Show error message as AI response
      const errorMsg: ChatMessage = {
        id: Date.now() + 1,
        userId: 0,
        role: 'assistant',
        content: '抱歉，发送失败，请稍后重试。',
        stockCode: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  }, [inputText, loading]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div style={styles.container}>
      {/* Message List */}
      <div style={styles.messageList} ref={listRef} data-testid="message-list">
        {historyLoading ? (
          <div style={styles.centerText}>加载中...</div>
        ) : messages.length === 0 ? (
          <div style={styles.centerText}>发送消息开始对话 💬</div>
        ) : (
          messages.map((msg) => (
            <ChatBubble
              key={msg.id}
              role={msg.role}
              content={msg.content}
              createdAt={msg.createdAt}
            />
          ))
        )}
        {loading && (
          <ChatBubble
            role="assistant"
            content=""
            createdAt={new Date().toISOString()}
            isLoading
          />
        )}
        {timeoutError && (
          <div style={styles.timeoutMsg} role="alert">
            分析超时，请稍后重试
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div style={styles.inputArea}>
        <input
          type="text"
          style={styles.input}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          aria-label="消息输入框"
          disabled={loading}
        />
        <button
          type="button"
          style={{
            ...styles.sendButton,
            opacity: !inputText.trim() || loading ? 0.5 : 1,
          }}
          onClick={handleSend}
          disabled={!inputText.trim() || loading}
          aria-label="发送消息"
        >
          发送
        </button>
      </div>

      {/* Calm Down Dialog */}
      {calmDownEval && (
        <CalmDownDialog
          evaluation={calmDownEval}
          onClose={() => setCalmDownEval(null)}
        />
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'linear-gradient(180deg, #f0f2f5 0%, #e8eaf0 100%)',
  },
  messageList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px 0',
  },
  centerText: {
    textAlign: 'center' as const,
    color: '#8b8fa3',
    fontSize: '14px',
    padding: '40px 0',
  },
  timeoutMsg: {
    textAlign: 'center' as const,
    color: '#ff4d4f',
    fontSize: '13px',
    padding: '10px 16px',
    margin: '0 12px 12px',
    background: 'linear-gradient(135deg, #fff2f0, #ffe8e6)',
    borderRadius: '12px',
    border: '1px solid rgba(255,77,79,0.1)',
  },
  inputArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.9)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderTop: '1px solid rgba(0,0,0,0.06)',
  },
  input: {
    flex: 1,
    height: '44px',
    border: '1px solid #e0e3ea',
    borderRadius: '22px',
    padding: '0 18px',
    fontSize: '14px',
    outline: 'none',
    background: '#f8f9fc',
    transition: 'all 0.2s ease',
    color: '#1a1a2e',
  },
  sendButton: {
    minWidth: '64px',
    height: '44px',
    border: 'none',
    borderRadius: '22px',
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
    boxShadow: '0 4px 12px rgba(102,126,234,0.3)',
    letterSpacing: '0.3px',
  },
};

export default ChatPage;
