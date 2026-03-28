import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { logoutUser } from '../api/auth';
import apiClient from '../api/client';

const ProfitChart = lazy(() => import('../components/ProfitChart'));
const SectorPieChart = lazy(() => import('../components/SectorPieChart'));

interface UserInfo {
  id: number;
  username: string;
}

interface AccuracyStats {
  totalPicks: number;
  profitCount: number;
  lossCount: number;
  avgReturn: number;
  winRate: number;
}

function getUserInfo(): UserInfo | null {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'number' && typeof parsed.username === 'string') {
      return parsed as UserInfo;
    }
    return null;
  } catch {
    return null;
  }
}

const MENU_ITEMS = [
  { icon: '📝', label: '操作复盘', path: '/oplog' },
  { icon: '📊', label: '历史参考记录', path: '/analysis-history' },
  { icon: '📈', label: 'AI准确率统计', path: '/accuracy-stats' },
  { icon: '⚙️', label: '分析设置', path: '/analysis-settings' },
  { icon: '🔔', label: '通知设置', path: '/notification-settings' },
  { icon: '📄', label: '用户协议与免责声明', path: '/terms' },
  { icon: 'ℹ️', label: '关于', path: '/about' },
];

const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [accuracy, setAccuracy] = useState<AccuracyStats | null>(null);

  useEffect(() => {
    setUser(getUserInfo());
    apiClient.get('/daily-pick/accuracy').then(res => setAccuracy(res.data)).catch(() => {});
  }, []);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await logoutUser();
    } catch {
      // proceed with local cleanup even if API fails
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  }, []);

  return (
    <div style={styles.container}>
      {/* Header — matches prototype: dark gradient, centered avatar + username */}
      <div style={styles.header}>
        <div style={styles.avatar} data-testid="user-avatar">👤</div>
        <div style={styles.username} data-testid="username">
          {user ? user.username : '未登录'}
        </div>
      </div>

      <div style={styles.body}>
        {/* Accuracy Overview Card */}
        {accuracy && accuracy.totalPicks > 0 && (
          <div style={styles.card} data-testid="accuracy-overview">
            <div style={styles.cardTitle}>📊 每日关注准确率</div>
            <div style={styles.accuracyGrid}>
              <div style={styles.accuracyItem}>
                <div style={styles.accuracyLabel}>总推荐</div>
                <div style={styles.accuracyValue}>{accuracy.totalPicks}</div>
              </div>
              <div style={styles.accuracyItem}>
                <div style={styles.accuracyLabel}>盈利</div>
                <div style={{ ...styles.accuracyValue, color: '#ff4757' }}>{accuracy.profitCount}</div>
              </div>
              <div style={styles.accuracyItem}>
                <div style={styles.accuracyLabel}>亏损</div>
                <div style={{ ...styles.accuracyValue, color: '#2ed573' }}>{accuracy.lossCount}</div>
              </div>
              <div style={styles.accuracyItem}>
                <div style={styles.accuracyLabel}>平均收益</div>
                <div style={{ ...styles.accuracyValue, color: accuracy.avgReturn >= 0 ? '#ff4757' : '#2ed573' }}>
                  {accuracy.avgReturn >= 0 ? '+' : ''}{accuracy.avgReturn.toFixed(1)}%
                </div>
              </div>
            </div>
            <div style={styles.accuracyBarRow}>
              <span style={styles.accuracyBarLabel}>准确率 {(accuracy.winRate * 100).toFixed(1)}%</span>
            </div>
            <div style={styles.accuracyTrack}>
              <div style={{ ...styles.accuracyFill, width: `${Math.min(accuracy.winRate * 100, 100)}%` }} />
            </div>
          </div>
        )}

        {/* Sector Pie Chart */}
        <div style={styles.card}>
          <Suspense fallback={<ChartSkeleton />}>
            <SectorPieChart />
          </Suspense>
        </div>

        {/* Profit Chart */}
        <div style={styles.card}>
          <Suspense fallback={<ChartSkeleton />}>
            <ProfitChart />
          </Suspense>
        </div>

        {/* Menu Items */}
        {MENU_ITEMS.map((item) => (
          <button
            key={item.path}
            type="button"
            style={styles.menuItem}
            onClick={() => navigate(item.path)}
            data-testid={`menu-${item.path.slice(1)}`}
          >
            <span style={styles.menuLabel}>{item.icon} {item.label}</span>
            <span style={styles.menuArrow}>›</span>
          </button>
        ))}

        {/* Logout Button */}
        <button
          type="button"
          style={styles.logoutButton}
          onClick={handleLogout}
          disabled={loggingOut}
          data-testid="logout-btn"
        >
          🚪 {loggingOut ? '退出中...' : '退出登录'}
        </button>
      </div>
    </div>
  );
};

function ChartSkeleton() {
  return (
    <div style={{ padding: '18px' }}>
      <div style={{ height: 14, width: '30%', borderRadius: 7, background: '#eee' }} />
      <div style={{ height: 80, width: '100%', borderRadius: 7, background: '#eee', marginTop: 12 }} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#f5f6fa',
    minHeight: '100%',
  },
  header: {
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    color: '#fff',
    padding: '32px 16px',
    textAlign: 'center' as const,
  },
  avatar: {
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    background: '#4a69bd',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '28px',
    margin: '0 auto 8px',
  },
  username: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#fff',
  },
  body: {
    padding: '16px',
  },
  card: {
    background: '#fff',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  cardTitle: {
    fontSize: '14px',
    fontWeight: 700,
    marginBottom: '12px',
  },
  accuracyGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    gap: '8px',
    marginBottom: '12px',
  },
  accuracyItem: {
    textAlign: 'center' as const,
  },
  accuracyLabel: {
    fontSize: '11px',
    color: '#999',
    marginBottom: '2px',
  },
  accuracyValue: {
    fontSize: '18px',
    fontWeight: 700,
  },
  accuracyBarRow: {
    marginBottom: '6px',
  },
  accuracyBarLabel: {
    fontSize: '12px',
    color: '#666',
  },
  accuracyTrack: {
    height: '8px',
    background: '#f0f0f0',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  accuracyFill: {
    height: '100%',
    borderRadius: '4px',
    background: 'linear-gradient(to right, #4a69bd, #2ed573)',
    transition: 'width 0.5s ease',
  },
  menuItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    background: '#fff',
    padding: '16px',
    borderRadius: '10px',
    marginBottom: '8px',
    border: 'none',
    fontSize: '15px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    minHeight: '44px',
  },
  menuLabel: {
    color: '#333',
  },
  menuArrow: {
    color: '#ccc',
    fontSize: '18px',
  },
  logoutButton: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    background: '#fff',
    padding: '16px',
    borderRadius: '10px',
    marginBottom: '8px',
    border: 'none',
    fontSize: '15px',
    color: '#ff4757',
    cursor: 'pointer',
    minHeight: '44px',
  },
};

export default ProfilePage;
