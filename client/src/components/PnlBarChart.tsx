import React, { useEffect, useState, useRef, useCallback } from 'react';
import { getChartData, StockPnlItem } from '../api/snapshot';

const PnlBarChart: React.FC = () => {
  const [data, setData] = useState<StockPnlItem[]>([]);
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

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(false);
    getChartData('30d')
      .then((res) => { setData(res.stockPnl); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  useEffect(() => {
    if (visible) fetchData();
  }, [visible, fetchData]);

  return (
    <div ref={containerRef} style={styles.card} data-testid="pnl-bar-card">
      <div style={styles.title}>📊 个股盈亏</div>
      {!visible ? null : loading ? (
        <div style={styles.skeleton} data-testid="pnl-loading"><div style={styles.skeletonBar} /></div>
      ) : error ? (
        <div style={styles.empty} data-testid="pnl-error">加载失败</div>
      ) : data.length === 0 ? (
        <div style={styles.empty} data-testid="pnl-empty">
          <div style={styles.emptyIcon}>📊</div>
          <div>暂无盈亏数据</div>
          <div style={styles.emptyHint}>持仓快照将在每个交易日收盘后记录</div>
        </div>
      ) : (
        <PnlBars items={data} />
      )}
    </div>
  );
};


const PnlBars: React.FC<{ items: StockPnlItem[] }> = ({ items }) => {
  const maxAbs = Math.max(...items.map((i) => Math.abs(i.profitLoss)), 1);

  return (
    <div style={styles.barList} data-testid="pnl-bars">
      {items.map((item, idx) => {
        const isProfit = item.profitLoss >= 0;
        const width = (Math.abs(item.profitLoss) / maxAbs) * 100;
        const color = isProfit ? '#ff4d4f' : '#52c41a';
        const bgColor = isProfit ? 'rgba(255,77,79,0.12)' : 'rgba(82,196,26,0.12)';
        const sign = isProfit ? '+' : '';

        return (
          <div key={idx} style={styles.barItem} data-testid={`pnl-item-${idx}`}>
            <div style={styles.barHeader}>
              <span style={styles.stockName}>{item.stockName}</span>
              <span style={{ ...styles.pnlValue, color }}>
                {sign}¥{item.profitLoss.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div style={styles.barTrack}>
              <div
                style={{
                  ...styles.barFill,
                  width: `${Math.max(width, 3)}%`,
                  background: bgColor,
                  borderLeft: `3px solid ${color}`,
                }}
                data-testid={`pnl-bar-${idx}`}
              />
            </div>
            <div style={styles.barFooter}>
              <span style={styles.stockCode}>{item.stockCode}</span>
              <span style={styles.marketValue}>
                市值 ¥{item.marketValue.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        );
      })}
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
  barList: { display: 'flex', flexDirection: 'column' as const, gap: '12px' },
  barItem: {},
  barHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
  },
  stockName: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e' },
  pnlValue: { fontSize: '14px', fontWeight: 700 },
  barTrack: {
    height: '20px',
    borderRadius: '4px',
    background: 'rgba(139,143,163,0.04)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
  barFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '2px',
  },
  stockCode: { fontSize: '12px', color: '#b0b4c8' },
  marketValue: { fontSize: '12px', color: '#8b8fa3' },
};

export default PnlBarChart;
