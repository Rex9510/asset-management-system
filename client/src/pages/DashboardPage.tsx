import React, { useEffect, useState, useCallback } from 'react';
import { getPositions, Position } from '../api/positions';
import { getDailyPicks, DailyPickMessage } from '../api/messages';
import StockCard from '../components/StockCard';
import DailyPickCard from '../components/DailyPickCard';

type TabType = 'holding' | 'watching';

const DashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('holding');
  const [positions, setPositions] = useState<Position[]>([]);
  const [dailyPicks, setDailyPicks] = useState<DailyPickMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [picksLoading, setPicksLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPositions = useCallback(async (tab: TabType) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPositions(tab);
      setPositions(data);
    } catch {
      setError('加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDailyPicks = useCallback(async () => {
    setPicksLoading(true);
    try {
      const data = await getDailyPicks();
      setDailyPicks(data);
    } catch {
      // silently ignore daily picks error
    } finally {
      setPicksLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions(activeTab);
  }, [activeTab, fetchPositions]);

  useEffect(() => {
    fetchDailyPicks();
  }, [fetchDailyPicks]);

  const handleRefresh = () => {
    fetchPositions(activeTab);
    fetchDailyPicks();
  };

  return (
    <div style={styles.container}>
      {/* Daily Picks Section */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>📈 每日关注</span>
        </div>
        {picksLoading ? (
          <div style={styles.emptyState}>加载中...</div>
        ) : dailyPicks.length === 0 ? (
          <div style={styles.emptyState}>暂无每日关注</div>
        ) : (
          dailyPicks.map((pick) => (
            <DailyPickCard key={pick.id} message={pick} />
          ))
        )}
      </div>

      {/* Tab Bar */}
      <div style={styles.tabBar}>
        <button
          type="button"
          style={{
            ...styles.tabButton,
            ...(activeTab === 'holding' ? styles.tabActive : {}),
          }}
          onClick={() => setActiveTab('holding')}
          aria-pressed={activeTab === 'holding'}
        >
          持仓
        </button>
        <button
          type="button"
          style={{
            ...styles.tabButton,
            ...(activeTab === 'watching' ? styles.tabActive : {}),
          }}
          onClick={() => setActiveTab('watching')}
          aria-pressed={activeTab === 'watching'}
        >
          关注
        </button>
        <button
          type="button"
          style={styles.refreshButton}
          onClick={handleRefresh}
          aria-label="刷新数据"
        >
          🔄
        </button>
      </div>

      {/* Position List */}
      <div style={styles.listSection}>
        {loading ? (
          <div style={styles.emptyState}>加载中...</div>
        ) : error ? (
          <div style={styles.errorState}>{error}</div>
        ) : positions.length === 0 ? (
          <div style={styles.emptyState}>
            {activeTab === 'holding' ? '暂无持仓记录' : '暂无关注股票'}
          </div>
        ) : (
          positions.map((pos) => (
            <StockCard key={pos.id} position={pos} />
          ))
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '12px 16px',
    background: '#f5f5f5',
    minHeight: '100%',
  },
  section: {
    marginBottom: '16px',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  sectionTitle: {
    fontSize: '17px',
    fontWeight: 600,
    color: '#333',
  },
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0',
    marginBottom: '12px',
    background: '#fff',
    borderRadius: '12px',
    padding: '4px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  tabButton: {
    flex: 1,
    padding: '10px 0',
    border: 'none',
    background: 'transparent',
    fontSize: '14px',
    fontWeight: 500,
    color: '#999',
    cursor: 'pointer',
    borderRadius: '10px',
    minHeight: '44px',
    transition: 'all 0.2s',
  },
  tabActive: {
    background: '#1890ff',
    color: '#fff',
    fontWeight: 600,
  },
  refreshButton: {
    width: '44px',
    height: '44px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  listSection: {
    minHeight: '100px',
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '32px 0',
    color: '#999',
    fontSize: '14px',
  },
  errorState: {
    textAlign: 'center' as const,
    padding: '32px 0',
    color: '#ff4d4f',
    fontSize: '14px',
  },
};

export default DashboardPage;
