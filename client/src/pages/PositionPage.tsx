import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { getPositions, Position } from '../api/positions';
import StockCard from '../components/StockCard';
import PositionForm from '../components/PositionForm';
import { useMarketSSE } from '../hooks/useMarketSSE';

type TabType = 'holding' | 'watching';

const PositionPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('holding');
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);

  const stockCodes = useMemo(() => positions.map(p => p.stockCode), [positions]);
  const { quotes, isDelayed } = useMarketSSE(stockCodes);

  const mergedPositions = useMemo(() => {
    return positions.map(pos => {
      const quote = quotes.get(pos.stockCode);
      if (!quote) return pos;
      const currentPrice = quote.price;
      const profitLoss = pos.costPrice != null && pos.shares != null
        ? (currentPrice - pos.costPrice) * pos.shares : pos.profitLoss;
      const profitLossPercent = pos.costPrice != null && pos.costPrice > 0
        ? ((currentPrice - pos.costPrice) / pos.costPrice) * 100 : pos.profitLossPercent;
      return { ...pos, currentPrice, profitLoss, profitLossPercent };
    });
  }, [positions, quotes]);

  // Compute portfolio summary from holding positions
  const portfolioSummary = useMemo(() => {
    const holdings = mergedPositions.filter(p => p.positionType === 'holding');
    let totalValue = 0;
    let totalCost = 0;
    let todayPnl = 0;
    holdings.forEach(pos => {
      if (pos.currentPrice != null && pos.shares != null) {
        totalValue += pos.currentPrice * pos.shares;
      }
      if (pos.costPrice != null && pos.shares != null) {
        totalCost += pos.costPrice * pos.shares;
      }
      // Approximate today P&L from quote change
      const quote = quotes.get(pos.stockCode);
      if (quote && pos.shares != null) {
        const prevClose = quote.price / (1 + (quote.changePercent || 0) / 100);
        todayPnl += (quote.price - prevClose) * pos.shares;
      }
    });
    const totalPnl = totalValue - totalCost;
    const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    return { totalValue, totalPnl, totalPnlPercent, todayPnl };
  }, [mergedPositions, quotes]);

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

  useEffect(() => {
    fetchPositions(activeTab);
  }, [activeTab, fetchPositions]);

  useEffect(() => {
    const handleTabRefresh = () => fetchPositions(activeTab);
    window.addEventListener('tab-switch-refresh', handleTabRefresh);
    return () => window.removeEventListener('tab-switch-refresh', handleTabRefresh);
  }, [activeTab, fetchPositions]);

  const handleAddPosition = () => {
    setEditingPosition(null);
    setShowForm(true);
  };

  const handleEditPosition = (pos: Position) => {
    setEditingPosition(pos);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingPosition(null);
  };

  const handleFormSaved = () => {
    setShowForm(false);
    setEditingPosition(null);
    fetchPositions(activeTab);
  };

  return (
    <div style={styles.container}>
      {/* Sticky Header: Portfolio Summary + Tabs */}
      <div style={styles.stickyHeader}>
        {/* Portfolio Summary */}
        <div style={styles.portfolioHeader}>
          <div style={styles.portfolioTop}>
            <div style={styles.totalAssets}>
              ¥ {portfolioSummary.totalValue > 0 ? portfolioSummary.totalValue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}
            </div>
            <span style={styles.totalLabel}>总资产</span>
          </div>
          <div style={styles.pnlRow}>
            <span style={styles.pnlItem}>
              今日 <span style={{ color: portfolioSummary.todayPnl >= 0 ? '#ff4757' : '#2ed573' }}>
                {portfolioSummary.todayPnl >= 0 ? '+' : ''}{portfolioSummary.todayPnl.toFixed(2)}
              </span>
            </span>
            <span style={styles.pnlItem}>
              总盈亏 <span style={{ color: portfolioSummary.totalPnl >= 0 ? '#ff4757' : '#2ed573' }}>
                {portfolioSummary.totalPnl >= 0 ? '+' : ''}{portfolioSummary.totalPnl.toFixed(2)} ({portfolioSummary.totalPnlPercent >= 0 ? '+' : ''}{portfolioSummary.totalPnlPercent.toFixed(2)}%)
              </span>
            </span>
          </div>
        </div>

        {/* Tab Bar */}
        <div style={styles.tabBar}>
          <button
            type="button"
            style={{
              ...styles.tabButton,
              ...(activeTab === 'holding' ? styles.tabActive : styles.tabInactive),
            }}
            onClick={() => setActiveTab('holding')}
            aria-pressed={activeTab === 'holding'}
          >
            📦 我的持仓
          </button>
          <button
            type="button"
            style={{
              ...styles.tabButton,
              ...(activeTab === 'watching' ? styles.tabActive : styles.tabInactive),
            }}
            onClick={() => setActiveTab('watching')}
            aria-pressed={activeTab === 'watching'}
          >
            👁 我的关注
          </button>
        </div>
      </div>

      {/* Position List */}
      <div style={styles.listSection}>
        {isDelayed && (
          <div style={styles.delayedWarning} role="alert">⚠️ 数据延迟，行情数据可能不是最新</div>
        )}
        {loading ? (
          <div style={styles.emptyState}>
            <div style={styles.skeleton} />
            <div style={{ ...styles.skeleton, width: '60%' }} />
            <div style={{ ...styles.skeleton, width: '80%' }} />
          </div>
        ) : error ? (
          <div style={styles.errorState}>{error}</div>
        ) : mergedPositions.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>{activeTab === 'holding' ? '📦' : '👁'}</div>
            <div style={{ fontSize: '14px', color: '#999' }}>
              {activeTab === 'holding' ? '暂无持仓记录' : '暂无关注股票'}
            </div>
            <div style={{ fontSize: '12px', color: '#bbb', marginTop: '4px' }}>
              {activeTab === 'holding' ? '点击右下角 + 添加持仓' : '从「今日关注」点击「加入关注」添加'}
            </div>
          </div>
        ) : (
          mergedPositions.map((pos) => (
            <StockCard
              key={pos.id}
              position={pos}
              onEdit={pos.positionType === 'holding' ? () => handleEditPosition(pos) : undefined}
              onRemoved={() => fetchPositions(activeTab)}
            />
          ))
        )}
      </div>

      {/* FAB for adding position */}
      <button
        type="button"
        style={styles.fab}
        onClick={handleAddPosition}
        aria-label="添加持仓"
      >
        +
      </button>

      {showForm && (
        <PositionForm
          position={editingPosition}
          defaultType={activeTab}
          onClose={handleFormClose}
          onSaved={handleFormSaved}
        />
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100%',
    background: 'transparent',
    paddingBottom: '80px',
  },
  stickyHeader: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
  },
  portfolioHeader: {
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    color: '#fff',
    padding: '12px 16px 10px',
  },
  portfolioTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  totalAssets: {
    fontSize: '22px',
    fontWeight: 700,
    letterSpacing: '-0.5px',
  },
  totalLabel: {
    fontSize: '11px',
    color: '#aaa',
  },
  pnlRow: {
    display: 'flex',
    gap: '12px',
    fontSize: '11px',
    marginTop: '4px',
    color: '#ccc',
  },
  pnlItem: {
    whiteSpace: 'nowrap' as const,
  },
  tabBar: {
    display: 'flex',
    background: '#fff',
    borderBottom: '1px solid #eee',
  },
  tabButton: {
    flex: 1,
    padding: '10px',
    textAlign: 'center' as const,
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    minHeight: '44px',
    transition: 'all 0.2s ease',
  },
  tabActive: {
    background: '#4a69bd',
    color: '#fff',
  },
  tabInactive: {
    background: '#fff',
    color: '#666',
  },
  listSection: {
    padding: '12px',
    minHeight: '200px',
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '60px 20px',
    color: '#999',
  },
  errorState: {
    textAlign: 'center' as const,
    padding: '40px 0',
    color: '#ff4d4f',
    fontSize: '14px',
  },
  delayedWarning: {
    background: 'linear-gradient(135deg, #fff7e6, #fff3cd)',
    color: '#d48806',
    padding: '10px 14px',
    borderRadius: '10px',
    fontSize: '13px',
    marginBottom: '10px',
    textAlign: 'center' as const,
    border: '1px solid rgba(212,136,6,0.15)',
  },
  skeleton: {
    height: '16px',
    background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
    backgroundSize: '200% 100%',
    borderRadius: '8px',
    marginBottom: '12px',
    width: '100%',
  },
  fab: {
    position: 'fixed' as const,
    bottom: '80px',
    right: '16px',
    width: '52px',
    height: '52px',
    borderRadius: '50%',
    background: '#4a69bd',
    color: '#fff',
    border: 'none',
    fontSize: '28px',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(74,105,189,0.4)',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

export default PositionPage;
