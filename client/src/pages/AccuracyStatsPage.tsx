import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';

interface AccuracyStats {
  totalPicks: number;
  profitCount: number;
  lossCount: number;
  avgReturn: number;
  winRate: number;
}

function SkeletonBlock() {
  return (
    <div style={styles.skeletonBlock}>
      <div style={{ ...styles.skeletonLine, width: '40%' }} />
      <div style={{ ...styles.skeletonLine, width: '70%', marginTop: 12 }} />
      <div style={{ ...styles.skeletonLine, width: '55%', marginTop: 8 }} />
    </div>
  );
}

const AccuracyStatsPage: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<AccuracyStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get('/daily-pick/accuracy');
        setStats(res.data);
      } catch { /* silently ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button type="button" style={styles.backBtn} onClick={() => navigate('/profile')} aria-label="返回" data-testid="back-btn">←</button>
        <span style={styles.headerTitle}>AI准确率统计</span>
        <div style={{ width: 44 }} />
      </div>

      <div style={styles.content}>
        {loading ? (
          <div data-testid="loading-state"><SkeletonBlock /><SkeletonBlock /></div>
        ) : !stats || stats.totalPicks === 0 ? (
          <div style={styles.emptyState} data-testid="empty-state">
            <div style={styles.emptyIcon}>🎯</div>
            <div style={styles.emptyText}>暂无准确率数据</div>
            <div style={styles.emptySub}>每日关注追踪数据积累后将自动统计</div>
          </div>
        ) : (
          <>
            {/* Win Rate Hero */}
            <div style={styles.heroCard}>
              <div style={styles.heroLabel}>综合胜率</div>
              <div style={styles.heroValue} data-testid="win-rate">{(stats.winRate * 100).toFixed(1)}%</div>
              <div style={styles.progressTrack}>
                <div style={{ ...styles.progressFill, width: `${Math.min(stats.winRate * 100, 100)}%` }} data-testid="win-rate-bar" />
              </div>
              <div style={styles.heroHint}>基于 {stats.totalPicks} 次每日关注追踪</div>
            </div>

            {/* Stats Grid */}
            <div style={styles.grid}>
              <StatCard label="总关注数" value={String(stats.totalPicks)} icon="📋" testId="total-picks" />
              <StatCard label="盈利次数" value={String(stats.profitCount)} icon="📈" color="#ff4d4f" testId="profit-count" />
              <StatCard label="亏损次数" value={String(stats.lossCount)} icon="📉" color="#52c41a" testId="loss-count" />
              <StatCard label="平均收益" value={`${stats.avgReturn >= 0 ? '+' : ''}${stats.avgReturn.toFixed(2)}%`} icon="💰" color={stats.avgReturn >= 0 ? '#ff4d4f' : '#52c41a'} testId="avg-return" />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

function StatCard({ label, value, icon, color, testId }: { label: string; value: string; icon: string; color?: string; testId: string }) {
  return (
    <div style={styles.statCard} data-testid={testId}>
      <div style={styles.statIcon}>{icon}</div>
      <div style={{ ...styles.statValue, color: color || '#1a1a2e' }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', background: 'linear-gradient(180deg, #f0f0ff 0%, #f8f9ff 100%)', paddingBottom: 24 },
  header: {
    position: 'sticky', top: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', background: 'linear-gradient(135deg, #667eea, #764ba2)', boxShadow: '0 2px 12px rgba(102,126,234,0.3)',
  },
  backBtn: {
    width: 44, height: 44, border: 'none', background: 'rgba(255,255,255,0.15)', borderRadius: 12,
    color: '#fff', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent', transition: 'background 0.2s ease',
  },
  headerTitle: { fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: 0.5 },
  content: { padding: 16 },
  heroCard: {
    textAlign: 'center' as const, padding: '28px 20px', marginBottom: 16,
    background: 'linear-gradient(135deg, #667eea, #764ba2)', borderRadius: 16,
    boxShadow: '0 4px 20px rgba(102,126,234,0.3)',
  },
  heroLabel: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginBottom: 4 },
  heroValue: { fontSize: 42, fontWeight: 800, color: '#fff', marginBottom: 12 },
  progressTrack: { height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.2)', overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: '100%', borderRadius: 4, background: '#fff', transition: 'width 0.5s ease' },
  heroHint: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  statCard: {
    background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    borderRadius: 14, padding: '18px 16px', textAlign: 'center' as const,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(255,255,255,0.6)',
  },
  statIcon: { fontSize: 24, marginBottom: 6 },
  statValue: { fontSize: 22, fontWeight: 800, marginBottom: 4 },
  statLabel: { fontSize: 12, color: '#8b8fa3', fontWeight: 500 },
  emptyState: { textAlign: 'center' as const, padding: '60px 20px' },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 16, fontWeight: 600, color: '#1a1a2e', marginBottom: 6 },
  emptySub: { fontSize: 13, color: '#8b8fa3' },
  skeletonBlock: {
    background: 'rgba(255,255,255,0.7)', borderRadius: 14, padding: 18, marginBottom: 12,
    boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
  },
  skeletonLine: {
    height: 14, borderRadius: 7,
    background: 'linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%)', backgroundSize: '200% 100%',
  },
};

export default AccuracyStatsPage;
