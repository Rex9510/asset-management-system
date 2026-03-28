import React, { useEffect, useState } from 'react';
import { getChainStatus, ChainNode, ChainStatusData } from '../api/chain';

const statusColors: Record<string, { bg: string; color: string; border: string; tagBg: string }> = {
  activated: { bg: 'rgba(46,213,115,0.12)', color: '#2ed573', border: '#2ed573', tagBg: 'rgba(46,213,115,0.15)' },
  transmitting: { bg: 'rgba(255,165,2,0.10)', color: '#ffa502', border: '#ffa502', tagBg: 'rgba(255,165,2,0.15)' },
  inactive: { bg: 'rgba(108,92,231,0.08)', color: '#6c5ce7', border: '#a29bfe', tagBg: 'rgba(108,92,231,0.12)' },
};

const statusLabel: Record<string, string> = {
  activated: '已走主升',
  transmitting: '传导中',
  inactive: '可埋伏',
};

function formatChange(change: number): string {
  if (change >= 100) return '+' + Math.round(change) + '%';
  if (change >= 0) return '+' + change.toFixed(1) + '%';
  return change.toFixed(1) + '%';
}

const CommodityChain: React.FC = () => {
  const [data, setData] = useState<ChainStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getChainStatus()
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  if (error || (!loading && !data)) return null;

  return (
    <div style={styles.card} data-testid="commodity-chain-card">
      <div style={styles.header}>
        <span style={styles.title}>📦 商品传导链</span>
        <span style={styles.period}>5年轮动</span>
      </div>
      {loading ? (
        <div style={styles.skeleton} data-testid="chain-loading">
          <div style={styles.skeletonBar} />
        </div>
      ) : (
        <>
          <div style={styles.chainRow} data-testid="chain-row">
            {data!.nodes.map((node, idx) => (
              <React.Fragment key={node.symbol}>
                <ChainNodeCard node={node} />
                {idx < data!.nodes.length - 1 && (
                  <span style={{ ...styles.arrow, color: getArrowColor(data!.nodes, idx) }}>→</span>
                )}
              </React.Fragment>
            ))}
          </div>
          <div style={styles.legend}>
            <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#2ed573' }} />已走主升</span>
            <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#ffa502' }} />传导中</span>
            <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#6c5ce7' }} />可埋伏</span>
          </div>
        </>
      )}
    </div>
  );
};

function getArrowColor(nodes: ChainNode[], idx: number): string {
  const node = nodes[idx];
  const next = nodes[idx + 1];
  if (node?.status === 'activated' && next?.status === 'activated') return '#2ed573';
  if (node?.status === 'activated' && next?.status === 'transmitting') return '#2ed573';
  return '#ddd';
}

const ChainNodeCard: React.FC<{ node: ChainNode }> = ({ node }) => {
  const colors = statusColors[node.status] || statusColors.inactive;
  const changeColor = node.change10d >= 0 ? '#e74c3c' : '#2ed573';

  return (
    <div
      style={styles.nodeWrapper}
      data-testid={`chain-node-${node.symbol}`}
      data-status={node.status}
    >
      <div style={{ ...styles.circle, background: colors.bg, border: `2px solid ${colors.border}` }}>
        <span style={{ ...styles.circleText, color: colors.color }}>{node.shortName}</span>
      </div>
      <span style={{ ...styles.nodeName, color: colors.color }}>{node.name}</span>
      <span style={{ ...styles.changeText, color: changeColor }}>{formatChange(node.change10d)}</span>
      <span style={{ ...styles.labelTag, background: colors.tagBg, color: colors.color }}>
        {node.label || statusLabel[node.status]}
      </span>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: '12px',
    padding: '12px',
    marginBottom: '12px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '10px',
  },
  title: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#333',
  },
  period: {
    fontSize: '11px',
    color: '#999',
    background: '#f5f5f5',
    padding: '2px 8px',
    borderRadius: '6px',
  },
  chainRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0',
    paddingBottom: '4px',
  },
  nodeWrapper: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    flex: 1,
    minWidth: '0',
    gap: '1px',
  },
  circle: {
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleText: {
    fontSize: '10px',
    fontWeight: 600,
  },
  nodeName: {
    fontSize: '10px',
    fontWeight: 500,
  },
  changeText: {
    fontSize: '9px',
    fontWeight: 700,
    lineHeight: '1.2',
  },
  labelTag: {
    fontSize: '8px',
    padding: '1px 3px',
    borderRadius: '3px',
    whiteSpace: 'nowrap' as const,
    lineHeight: '1.4',
  },
  arrow: {
    fontSize: '10px',
    margin: '9px 0 0',
    flexShrink: 1,
    lineHeight: '1',
    color: '#ddd',
  },
  legend: {
    display: 'flex',
    gap: '12px',
    marginTop: '8px',
    justifyContent: 'center',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '10px',
    color: '#999',
  },
  legendDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  skeleton: {
    padding: '12px 0',
  },
  skeletonBar: {
    height: '80px',
    borderRadius: '10px',
    background: 'linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)',
    backgroundSize: '200% 100%',
  },
};

export default CommodityChain;
