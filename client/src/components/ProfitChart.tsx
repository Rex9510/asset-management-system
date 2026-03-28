import React, { useEffect, useState, useRef, useCallback } from 'react';
import { getChartData, ProfitCurvePoint } from '../api/snapshot';

type Period = '7d' | '30d' | '90d';

const ProfitChart: React.FC = () => {
  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<ProfitCurvePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fetchData = useCallback((p: Period) => {
    setLoading(true);
    setError(false);
    getChartData(p)
      .then((res) => { setData(res.profitCurve); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  useEffect(() => {
    if (visible) fetchData(period);
  }, [visible, period, fetchData]);

  const handlePeriodChange = (p: Period) => { setPeriod(p); };

  return (
    <div ref={containerRef} style={styles.card} data-testid="profit-chart-card">
      <div style={styles.header}>
        <span style={styles.title}>📈 收益曲线</span>
        <div style={styles.tabs} data-testid="period-tabs">
          {(['7d', '30d', '90d'] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              style={period === p ? { ...styles.tab, ...styles.tabActive } : styles.tab}
              onClick={() => handlePeriodChange(p)}
              data-testid={`period-tab-${p}`}
            >
              {p === '7d' ? '7天' : p === '30d' ? '30天' : '90天'}
            </button>
          ))}
        </div>
      </div>
      {!visible ? null : loading ? (
        <div style={styles.skeleton} data-testid="profit-loading"><div style={styles.skeletonBar} /></div>
      ) : error ? (
        <div style={styles.empty} data-testid="profit-error">加载失败</div>
      ) : data.length === 0 ? (
        <div style={styles.empty} data-testid="profit-empty">
          <div style={styles.emptyIcon}>📊</div>
          <div>暂无收益数据</div>
          <div style={styles.emptyHint}>持仓快照将在每个交易日收盘后记录</div>
        </div>
      ) : (
        <CurveArea points={data} />
      )}
    </div>
  );
};


const CurveArea: React.FC<{ points: ProfitCurvePoint[] }> = ({ points }) => {
  const maxVal = Math.max(...points.map((p) => p.totalValue), 1);
  const minVal = Math.min(...points.map((p) => p.totalValue), 0);
  const range = maxVal - minVal || 1;
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const totalChange = lastPoint && firstPoint && firstPoint.totalValue > 0
    ? ((lastPoint.totalValue - firstPoint.totalValue) / firstPoint.totalValue * 100)
    : 0;
  const isPositive = totalChange >= 0;

  return (
    <div data-testid="profit-curve">
      <div style={styles.summary}>
        <div>
          <div style={styles.summaryLabel}>最新市值</div>
          <div style={styles.summaryValue}>¥{lastPoint ? lastPoint.totalValue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={styles.summaryLabel}>区间收益</div>
          <div style={{ ...styles.summaryValue, color: isPositive ? '#ff4d4f' : '#52c41a' }}>
            {isPositive ? '+' : ''}{totalChange.toFixed(2)}%
          </div>
        </div>
      </div>
      <div style={styles.chartArea} data-testid="curve-bars">
        {points.map((p, i) => {
          const height = ((p.totalValue - minVal) / range) * 100;
          const barColor = p.totalProfit >= 0
            ? 'rgba(102,126,234,0.6)'
            : 'rgba(255,77,79,0.4)';
          return (
            <div key={i} style={styles.barWrapper} title={`${p.date}\n市值: ¥${p.totalValue.toFixed(2)}\n盈亏: ¥${p.totalProfit.toFixed(2)}`}>
              <div
                style={{
                  ...styles.bar,
                  height: `${Math.max(height, 2)}%`,
                  background: barColor,
                }}
                data-testid={`curve-bar-${i}`}
              />
            </div>
          );
        })}
      </div>
      <div style={styles.dateRow}>
        <span style={styles.dateLabel}>{points[0]?.date?.slice(5) || ''}</span>
        <span style={styles.dateLabel}>{points[points.length - 1]?.date?.slice(5) || ''}</span>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'rgba(255,255,255,0.9)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderRadius: '16px',
    padding: '16px',
    marginBottom: '16px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    border: '1px solid rgba(255,255,255,0.6)',
    animation: 'fadeIn 0.3s ease',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '14px',
  },
  title: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#1a1a2e',
    letterSpacing: '0.3px',
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    background: 'rgba(139,143,163,0.08)',
    borderRadius: '8px',
    padding: '2px',
  },
  tab: {
    fontSize: '12px',
    fontWeight: 500,
    padding: '6px 12px',
    borderRadius: '6px',
    border: 'none',
    background: 'transparent',
    color: '#8b8fa3',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    minHeight: '32px',
    minWidth: '44px',
  },
  tabActive: {
    background: '#fff',
    color: '#667eea',
    fontWeight: 700,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  },
  skeleton: { padding: '20px 0' },
  skeletonBar: {
    height: '120px',
    borderRadius: '10px',
    background: 'linear-gradient(90deg, rgba(139,143,163,0.08) 25%, rgba(139,143,163,0.15) 50%, rgba(139,143,163,0.08) 75%)',
    backgroundSize: '200% 100%',
  },
  empty: {
    textAlign: 'center' as const,
    padding: '32px 0',
    color: '#8b8fa3',
    fontSize: '14px',
  },
  emptyIcon: { fontSize: '32px', marginBottom: '8px' },
  emptyHint: { fontSize: '12px', color: '#b0b4c8', marginTop: '4px' },
  summary: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px',
  },
  summaryLabel: { fontSize: '12px', color: '#8b8fa3', marginBottom: '2px' },
  summaryValue: { fontSize: '18px', fontWeight: 700, color: '#1a1a2e' },
  chartArea: {
    display: 'flex',
    alignItems: 'flex-end',
    height: '100px',
    gap: '1px',
    padding: '0 2px',
  },
  barWrapper: {
    flex: 1,
    display: 'flex',
    alignItems: 'flex-end',
    height: '100%',
  },
  bar: {
    width: '100%',
    borderRadius: '2px 2px 0 0',
    transition: 'height 0.3s ease',
    minHeight: '2px',
  },
  dateRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '6px',
  },
  dateLabel: { fontSize: '12px', color: '#b0b4c8' },
};

export default ProfitChart;
