import React, { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getUnreadCount } from '../api/messages';

interface TabItem {
  key: string;
  path: string;
  label: string;
  icon: string;
}

const tabs: TabItem[] = [
  { key: 'dashboard', path: '/dashboard', label: '看板', icon: '📊' },
  { key: 'chat', path: '/chat', label: '对话', icon: '💬' },
  { key: 'messages', path: '/messages', label: '消息', icon: '🔔' },
  { key: 'profile', path: '/profile', label: '我的', icon: '👤' },
];

const BottomNav: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchUnread = useCallback(() => {
    getUnreadCount()
      .then(setUnreadCount)
      .catch(() => { /* silently ignore */ });
  }, []);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  // Refresh unread count when navigating to messages
  useEffect(() => {
    if (location.pathname === '/messages') {
      fetchUnread();
    }
  }, [location.pathname, fetchUnread]);

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav style={styles.nav} role="navigation" aria-label="底部导航">
      {tabs.map((tab) => {
        const active = isActive(tab.path);
        return (
          <button
            key={tab.key}
            type="button"
            style={{
              ...styles.tabButton,
              color: active ? '#1890ff' : '#999',
            }}
            onClick={() => navigate(tab.path)}
            aria-current={active ? 'page' : undefined}
            aria-label={tab.label}
          >
            <span style={styles.iconWrap}>
              <span style={styles.icon}>{tab.icon}</span>
              {tab.key === 'messages' && unreadCount > 0 && (
                <span style={styles.badge} aria-label={`${unreadCount}条未读消息`}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </span>
            <span style={{ fontSize: '11px', marginTop: '2px' }}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

const styles: Record<string, React.CSSProperties> = {
  nav: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    height: '56px',
    background: '#fff',
    borderTop: '1px solid #e8e8e8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    zIndex: 1000,
    maxWidth: '428px',
    margin: '0 auto',
  },
  tabButton: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: '4px 0',
    minWidth: '44px',
    minHeight: '44px',
    WebkitTapHighlightColor: 'transparent',
  },
  iconWrap: {
    position: 'relative' as const,
    display: 'inline-block',
  },
  icon: {
    fontSize: '22px',
    lineHeight: 1,
  },
  badge: {
    position: 'absolute' as const,
    top: '-4px',
    right: '-10px',
    background: '#ff4d4f',
    color: '#fff',
    fontSize: '10px',
    fontWeight: 700,
    lineHeight: '16px',
    minWidth: '16px',
    height: '16px',
    borderRadius: '8px',
    textAlign: 'center' as const,
    padding: '0 4px',
    boxSizing: 'border-box' as const,
  },
};

export default BottomNav;
