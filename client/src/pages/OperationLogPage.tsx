import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getOperationLogs, getReviews, OperationLog } from '../api/oplog';

const opTypeLabels: Record<string, { label: string; icon: string; color: string }> = {
  create: { label: '买入', icon: '📈', color: '#e74c3c' },
  update: { label: '调仓', icon: '🔄', color: '#667eea' },
  delete: { label: '卖出', icon: '📉', color: '#52c41a' },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${m}-${day} ${h}:${min}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* Skeleton placeholder for loading state */
function SkeletonCard() {
  return (
    <div style={styles.skeletonCard}>
      <div style={{ ...styles.skeletonLine, width: '40%' }} />
      <div style={{ ...styles.skeletonLine, width: '70%', marginTop: '10px' }} />
      <div style={{ ...styles.skeletonLine, width: '55%', marginTop: '8px' }} />
    </div>
  );
}

const OperationLogPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'logs' | 'reviews'>('logs');
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [reviews, setReviews] = useState<OperationLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await getOperationLogs(p, 20);
      setLogs(res.logs);
      setTotal(res.total);
    } catch { /* silently ignore */ }
    finally { setLoading(false); }
  }, []);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getReviews();
      setReviews(res);
    } catch { /* silently ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'logs') fetchLogs(page);
    else fetchReviews();
  }, [activeTab, page, fetchLogs, fetchReviews]);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div style={styles.container}>
      {/* Sticky Header */}
      <div style={styles.header}>
        <button
          type="button"
          style={styles.backBtn}
          onClick={() => navigate('/profile')}
          aria-label="返回"
          data-testid="back-btn"
        >
          ←
        </button>
        <span style={styles.headerTitle}>操作复盘</span>
        <div style={{ width: '44px' }} />
      </div>

      {/* Tabs */}
      <div style={styles.tabBar}>
        {(['logs', 'reviews'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            style={{
              ...styles.tabBtn,
              ...(activeTab === tab ? styles.tabBtnActive : {}),
            }}
            onClick={() => { setActiveTab(tab); if (tab === 'logs') setPage(1); }}
            data-testid={`tab-${tab}`}
          >
            {tab === 'logs' ? '操作记录' : '复盘评价'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={styles.content}>
        {loading ? (
          <div data-testid="loading-state">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : activeTab === 'logs' ? (
          logs.length === 0 ? (
            <EmptyState text="暂无操作记录" sub="持仓变动后将自动记录" />
          ) : (
            <>
              {logs.map((log) => <LogCard key={log.id} log={log} />)}
              {totalPages > 1 && (
                <div style={styles.pagination}>
                  <button
                    type="button"
                    style={{ ...styles.pageBtn, opacity: page <= 1 ? 0.4 : 1 }}
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    上一页
                  </button>
                  <span style={styles.pageInfo}>{page}/{totalPages}</span>
                  <button
                    type="button"
                    style={{ ...styles.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }}
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )
        ) : (
          reviews.length === 0 ? (
            <EmptyState text="暂无复盘评价" sub="操作满7天后将自动生成" />
          ) : (
            reviews.map((r) => <ReviewCard key={r.id} log={r} />)
          )
        )}
      </div>
    </div>
  );
};


/* --- Sub-components --- */

function EmptyState({ text, sub }: { text: string; sub: string }) {
  return (
    <div style={styles.emptyState} data-testid="empty-state">
      <div style={styles.emptyIcon}>📋</div>
      <div style={styles.emptyText}>{text}</div>
      <div style={styles.emptySub}>{sub}</div>
    </div>
  );
}

function LogCard({ log }: { log: OperationLog }) {
  const info = opTypeLabels[log.operationType] || { label: log.operationType, icon: '📝', color: '#999' };
  return (
    <div style={styles.card} data-testid="log-card">
      <div style={styles.cardRow}>
        <div style={styles.cardLeft}>
          <span style={{ ...styles.opBadge, background: info.color + '18', color: info.color }}>
            {info.icon} {info.label}
          </span>
          <span style={styles.stockName}>{log.stockName}</span>
          <span style={styles.stockCode}>{log.stockCode}</span>
        </div>
        <span style={styles.time}>{formatTime(log.createdAt)}</span>
      </div>
      <div style={styles.cardMeta}>
        {log.price != null && (
          <span style={styles.metaItem}>价格 <b style={styles.metaValue}>{log.price}</b></span>
        )}
        {log.shares != null && (
          <span style={styles.metaItem}>数量 <b style={styles.metaValue}>{log.shares}</b></span>
        )}
      </div>
      {log.aiSummary && (
        <div style={styles.aiSummary}>💡 {log.aiSummary}</div>
      )}
    </div>
  );
}

function ReviewCard({ log }: { log: OperationLog }) {
  const info = opTypeLabels[log.operationType] || { label: log.operationType, icon: '📝', color: '#999' };
  return (
    <div style={styles.card} data-testid="review-card">
      <div style={styles.cardRow}>
        <div style={styles.cardLeft}>
          <span style={{ ...styles.opBadge, background: info.color + '18', color: info.color }}>
            {info.icon} {info.label}
          </span>
          <span style={styles.stockName}>{log.stockName}</span>
          <span style={styles.stockCode}>{log.stockCode}</span>
        </div>
        <span style={styles.time}>{formatTime(log.createdAt)}</span>
      </div>
      {log.review7d && (
        <div style={styles.reviewBlock}>
          <div style={styles.reviewLabel}>
            7天复盘
            {log.review7dAt && <span style={styles.reviewDate}>{formatDate(log.review7dAt)}</span>}
          </div>
          <div style={styles.reviewText}>{log.review7d}</div>
        </div>
      )}
      {log.review30d && (
        <div style={styles.reviewBlock}>
          <div style={styles.reviewLabel}>
            30天复盘
            {log.review30dAt && <span style={styles.reviewDate}>{formatDate(log.review30dAt)}</span>}
          </div>
          <div style={styles.reviewText}>{log.review30d}</div>
        </div>
      )}
    </div>
  );
}

/* --- Styles --- */

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #f0f0ff 0%, #f8f9ff 100%)',
    paddingBottom: '24px',
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    boxShadow: '0 2px 12px rgba(102,126,234,0.3)',
  },
  backBtn: {
    width: '44px',
    height: '44px',
    border: 'none',
    background: 'rgba(255,255,255,0.15)',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
    transition: 'background 0.2s ease',
  },
  headerTitle: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '0.5px',
  },
  tabBar: {
    display: 'flex',
    gap: '0',
    padding: '12px 16px 0',
    background: 'transparent',
  },
  tabBtn: {
    flex: 1,
    padding: '10px 0',
    border: 'none',
    background: 'rgba(255,255,255,0.6)',
    fontSize: '14px',
    fontWeight: 600,
    color: '#8b8fa3',
    cursor: 'pointer',
    borderRadius: '12px 12px 0 0',
    transition: 'all 0.25s ease',
    minHeight: '44px',
    WebkitTapHighlightColor: 'transparent',
  },
  tabBtnActive: {
    background: 'rgba(255,255,255,0.95)',
    color: '#667eea',
    boxShadow: '0 -2px 8px rgba(102,126,234,0.1)',
  },
  content: {
    padding: '0 16px',
  },
  card: {
    background: 'rgba(255,255,255,0.92)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderRadius: '14px',
    padding: '16px',
    marginBottom: '10px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    border: '1px solid rgba(255,255,255,0.6)',
    animation: 'fadeIn 0.3s ease',
  },
  cardRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap' as const,
  },
  opBadge: {
    fontSize: '12px',
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: '8px',
    whiteSpace: 'nowrap' as const,
  },
  stockName: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#1a1a2e',
  },
  stockCode: {
    fontSize: '12px',
    color: '#8b8fa3',
  },
  time: {
    fontSize: '12px',
    color: '#8b8fa3',
    flexShrink: 0,
  },
  cardMeta: {
    display: 'flex',
    gap: '16px',
    marginTop: '10px',
  },
  metaItem: {
    fontSize: '13px',
    color: '#8b8fa3',
  },
  metaValue: {
    color: '#1a1a2e',
    fontWeight: 600,
    fontSize: '14px',
  },
  aiSummary: {
    marginTop: '10px',
    fontSize: '13px',
    color: '#667eea',
    lineHeight: '1.6',
    padding: '8px 12px',
    background: 'rgba(102,126,234,0.06)',
    borderRadius: '8px',
  },
  reviewBlock: {
    marginTop: '12px',
    padding: '10px 12px',
    background: 'rgba(102,126,234,0.04)',
    borderRadius: '10px',
    borderLeft: '3px solid #667eea',
  },
  reviewLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#667eea',
    marginBottom: '4px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  reviewDate: {
    fontSize: '12px',
    color: '#8b8fa3',
    fontWeight: 400,
  },
  reviewText: {
    fontSize: '14px',
    color: '#1a1a2e',
    lineHeight: '1.7',
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '60px 20px',
  },
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  emptyText: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#1a1a2e',
    marginBottom: '6px',
  },
  emptySub: {
    fontSize: '13px',
    color: '#8b8fa3',
  },
  pagination: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '16px',
    padding: '16px 0',
  },
  pageBtn: {
    minWidth: '80px',
    minHeight: '44px',
    border: '1px solid rgba(102,126,234,0.3)',
    borderRadius: '10px',
    background: 'rgba(255,255,255,0.9)',
    color: '#667eea',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    transition: 'all 0.2s ease',
  },
  pageInfo: {
    fontSize: '14px',
    color: '#8b8fa3',
    fontWeight: 500,
  },
  skeletonCard: {
    background: 'rgba(255,255,255,0.7)',
    borderRadius: '14px',
    padding: '18px',
    marginBottom: '10px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
  },
  skeletonLine: {
    height: '14px',
    borderRadius: '7px',
    background: 'linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s infinite',
  },
};

export default OperationLogPage;
