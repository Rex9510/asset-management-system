import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { getChartData, SectorDistItem } from '../api/snapshot';
import { getPositions, Position } from '../api/positions';
import { useMarketSSE } from '../hooks/useMarketSSE';

const SECTOR_COLORS = [
  '#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b',
  '#fa709a', '#fee140', '#30cfd0', '#a18cd1', '#fbc2eb',
];

const SectorPieChart: React.FC = () => {
  const [data, setData] = useState<SectorDistItem[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const holdings = useMemo(() => positions.filter((p) => p.positionType === 'holding'), [positions]);
  const stockCodes = useMemo(() => holdings.map((p) => p.stockCode), [holdings]);
  const { quotes, refreshQuotes } = useMarketSSE(stockCodes);

  const liveTotalValue = useMemo(() => {
    if (!holdings.length) return null;
    let total = 0;
    for (const p of holdings) {
      const quote = quotes.get(p.stockCode);
      const price = quote?.price ?? p.currentPrice ?? 0;
      const shares = p.shares ?? 0;
      total += price * shares;
    }
    return total > 0 ? total : null;
  }, [holdings, quotes]);

  const scaledItems = useMemo(() => {
    if (!data.length || liveTotalValue == null) return data;
    const snapSum = data.reduce((s, i) => s + i.value, 0);
    if (snapSum <= 0) return data;
    const factor = liveTotalValue / snapSum;
    return data.map((i) => ({
      ...i,
      value: Math.round(i.value * factor * 100) / 100,
    }));
  }, [data, liveTotalValue]);

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

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(false);
    Promise.all([getChartData('30d'), getPositions('holding').catch(() => [])])
      .then(([chart, pos]) => {
        setData(chart.sectorDistribution);
        setPositions(pos);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (visible) fetchData();
  }, [visible, fetchData]);

  useEffect(() => {
    if (!visible || stockCodes.length === 0) return;
    void refreshQuotes(stockCodes);
  }, [visible, stockCodes, refreshQuotes]);

  useEffect(() => {
    const onTab = (e: Event) => {
      const tab = (e as CustomEvent<{ tab: string }>).detail?.tab;
      if (tab !== 'profile' || !visible) return;
      fetchData();
    };
    window.addEventListener('tab-switch-refresh', onTab);
    return () => window.removeEventListener('tab-switch-refresh', onTab);
  }, [visible, fetchData]);

  return (
    <div ref={containerRef} style={styles.card} data-testid="sector-pie-card">
      <div style={styles.title}>🥧 板块分布</div>
      {!visible ? null : loading ? (
        <div style={styles.skeleton} data-testid="sector-loading"><div style={styles.skeletonBar} /></div>
      ) : error ? (
        <div style={styles.empty} data-testid="sector-error">加载失败</div>
      ) : data.length === 0 ? (
        <div style={styles.empty} data-testid="sector-empty">
          <div style={styles.emptyIcon}>🥧</div>
          <div>暂无板块分布数据</div>
          <div style={styles.emptyHint}>持仓快照将在每个交易日收盘后记录</div>
        </div>
      ) : (
        <SectorBars items={scaledItems} />
      )}
    </div>
  );
};


const SectorBars: React.FC<{ items: SectorDistItem[] }> = ({ items }) => {
  const maxPct = Math.max(...items.map((i) => i.percentage), 1);

  return (
    <div data-testid="sector-bars">
      {/* Donut ring visualization */}
      <div style={styles.donutContainer}>
        <div style={styles.donut}>
          <ConicGradientRing items={items} />
          <div style={styles.donutCenter}>
            <div style={styles.donutTotal}>{items.length}</div>
            <div style={styles.donutLabel}>板块</div>
          </div>
        </div>
      </div>
      {/* Legend bars */}
      <div style={styles.legendList}>
        {items.map((item, idx) => {
          const color = SECTOR_COLORS[idx % SECTOR_COLORS.length];
          const width = (item.percentage / maxPct) * 100;
          return (
            <div key={item.sector} style={styles.legendItem} data-testid={`sector-item-${idx}`}>
              <div style={styles.legendHeader}>
                <span style={{ ...styles.colorDot, background: color }} />
                <span style={styles.legendName}>{item.sector}</span>
                <span style={styles.legendPct}>{item.percentage.toFixed(1)}%</span>
                <span style={styles.legendValue}>¥{item.value.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
              </div>
              <div style={styles.barTrack}>
                <div style={{ ...styles.barFill, width: `${width}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ConicGradientRing: React.FC<{ items: SectorDistItem[] }> = ({ items }) => {
  let cumulative = 0;
  const segments = items.map((item, idx) => {
    const start = cumulative;
    cumulative += item.percentage;
    const color = SECTOR_COLORS[idx % SECTOR_COLORS.length];
    return `${color} ${start}% ${cumulative}%`;
  });
  const gradient = `conic-gradient(${segments.join(', ')})`;

  return (
    <div
      style={{ ...styles.donutRing, background: gradient }}
      data-testid="donut-ring"
    />
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
  title: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#1a1a2e',
    marginBottom: '14px',
    letterSpacing: '0.3px',
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
  donutContainer: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '16px',
  },
  donut: {
    position: 'relative' as const,
    width: '120px',
    height: '120px',
  },
  donutRing: {
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    mask: 'radial-gradient(circle at center, transparent 40px, black 41px)',
    WebkitMask: 'radial-gradient(circle at center, transparent 40px, black 41px)',
  },
  donutCenter: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center' as const,
  },
  donutTotal: { fontSize: '20px', fontWeight: 700, color: '#1a1a2e' },
  donutLabel: { fontSize: '12px', color: '#8b8fa3' },
  legendList: { display: 'flex', flexDirection: 'column' as const, gap: '10px' },
  legendItem: {},
  legendHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '4px',
  },
  colorDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  legendName: { fontSize: '13px', fontWeight: 600, color: '#1a1a2e', flex: 1 },
  legendPct: { fontSize: '13px', fontWeight: 700, color: '#667eea' },
  legendValue: { fontSize: '12px', color: '#8b8fa3', minWidth: '60px', textAlign: 'right' as const },
  barTrack: {
    height: '6px',
    borderRadius: '3px',
    background: 'rgba(139,143,163,0.08)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 0.3s ease',
    opacity: 0.7,
  },
};

export default SectorPieChart;
