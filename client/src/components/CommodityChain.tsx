import React, { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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
  const [detailNode, setDetailNode] = useState<ChainNode | null>(null);

  const closeDetail = useCallback(() => setDetailNode(null), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getChainStatus()
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!detailNode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailNode, closeDetail]);

  if (error || (!loading && !data)) return null;

  return (
    <div style={styles.card} data-testid="commodity-chain-card">
      <div style={styles.header}>
        <span style={styles.title}>📦 商品传导链</span>
        <span style={styles.period}>主3～5年</span>
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
                <ChainNodeCard node={node} onOpenDetail={() => setDetailNode(node)} />
                {idx < data!.nodes.length - 1 && (
                  <span style={{ ...styles.arrow, color: getArrowColor(data!.nodes, idx) }}>→</span>
                )}
              </React.Fragment>
            ))}
          </div>
          {detailNode &&
            createPortal(
              <ChainNodeDetailModal
                node={detailNode}
                onClose={closeDetail}
              />,
              document.body
            )}
          <div style={styles.legend}>
            <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#2ed573' }} />已走主升</span>
            <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#ffa502' }} />传导中</span>
            <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#6c5ce7' }} />可埋伏</span>
          </div>
          {data!.methodSummary && (
            <div style={styles.methodHint} data-testid="chain-method-hint">{data!.methodSummary}</div>
          )}
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

const ChainNodeCard: React.FC<{ node: ChainNode; onOpenDetail: () => void }> = ({ node, onOpenDetail }) => {
  const colors = statusColors[node.status] || statusColors.inactive;
  const changeColor = node.change10d >= 0 ? '#e74c3c' : '#2ed573';
  const auxColor =
    node.changeAux == null || Number.isNaN(node.changeAux)
      ? '#b0b0b0'
      : node.changeAux >= 0
        ? '#e67e22'
        : '#16a085';

  return (
    <button
      type="button"
      style={{ ...styles.nodeButton, ...styles.nodeWrapper, borderColor: colors.border }}
      data-testid={`chain-node-${node.symbol}`}
      data-status={node.status}
      aria-label={`${node.name} 详情`}
      onClick={onOpenDetail}
    >
      <div style={{ ...styles.circle, background: colors.bg, border: `2px solid ${colors.border}` }}>
        <span style={{ ...styles.circleText, color: colors.color }}>{node.shortName}</span>
      </div>
      <span style={{ ...styles.nodeName, color: colors.color }}>{node.name}</span>
      <span style={{ ...styles.changeText, color: changeColor }}>{formatChange(node.change10d)}</span>
      <span style={{ ...styles.auxText, color: auxColor }}>
        辅
        {node.changeAux == null || Number.isNaN(node.changeAux)
          ? '--'
          : formatChange(node.changeAux)}
      </span>
      <span style={{ ...styles.labelTag, background: colors.tagBg, color: colors.color }}>
        {node.label || statusLabel[node.status]}
      </span>
      <span style={styles.detailCue}>点击看明细</span>
    </button>
  );
};

function primaryWindowLabel(node: ChainNode): string {
  if (node.primaryWindowDays != null && node.primaryWindowDays > 0) {
    return `主窗口约 ${node.primaryWindowDays} 个交易日`;
  }
  return '主窗口约 3～5 年（按有效 K 线择优）';
}

const ChainNodeDetailModal: React.FC<{ node: ChainNode; onClose: () => void }> = ({ node, onClose }) => {
  const colors = statusColors[node.status] || statusColors.inactive;
  const changeColor = node.change10d >= 0 ? '#e74c3c' : '#2ed573';
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  return (
    <div
      style={styles.modalBackdrop}
      role="presentation"
      data-testid="chain-detail-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="chain-detail-title"
        style={styles.modalPanel}
        data-testid="chain-detail-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.modalHeader}>
          <div>
            <div id="chain-detail-title" style={styles.modalTitle}>
              {node.name}{' '}
              <span style={styles.modalSymbol}>{node.symbol}</span>
            </div>
            <div style={{ ...styles.modalStatusPill, background: colors.tagBg, color: colors.color }}>
              {node.label || statusLabel[node.status]}
            </div>
          </div>
          <button ref={closeBtnRef} type="button" style={styles.modalClose} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div style={styles.modalSection}>
          <div style={styles.modalDt}>主周期涨幅</div>
          <div style={{ ...styles.modalHero, color: changeColor }}>{formatChange(node.change10d)}</div>
          <div style={styles.modalDdMuted}>{primaryWindowLabel(node)}</div>
          {node.maxHistoryDays != null && node.maxHistoryDays > 0 && (
            <div style={styles.modalDdMuted}>可用历史约 {node.maxHistoryDays} 个交易日</div>
          )}
        </div>
        {node.changeAux != null && !Number.isNaN(node.changeAux) && (
          <div style={styles.modalSection}>
            <div style={styles.modalDt}>辅提示（近 6 月）</div>
            <div style={styles.modalDd}>{formatChange(node.changeAux)}</div>
          </div>
        )}
        {node.windowNote && (
          <div style={styles.modalSection}>
            <div style={styles.modalDt}>窗口说明</div>
            <div style={styles.modalDdWrap}>{node.windowNote}</div>
          </div>
        )}
        <p style={styles.modalFoot}>横向列表仅保留核心信息；完整辅线与说明在此查看。</p>
      </div>
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
  nodeButton: {
    border: '1px solid #e7eaf3',
    background: '#fafbff',
    borderRadius: '8px',
    padding: '4px 2px 3px',
    margin: 0,
    font: 'inherit',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    textAlign: 'center' as const,
  },
  nodeWrapper: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: '1px',
  },
  circle: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleText: {
    fontSize: '9px',
    fontWeight: 600,
  },
  nodeName: {
    fontSize: '9px',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.2,
  },
  changeText: {
    fontSize: '9px',
    fontWeight: 700,
    lineHeight: '1.15',
  },
  auxText: {
    fontSize: '7px',
    fontWeight: 600,
    lineHeight: '1.1',
  },
  detailCue: {
    fontSize: '7px',
    color: '#6b7280',
    marginTop: '1px',
    lineHeight: '1.1',
  },
  methodHint: {
    fontSize: '9px',
    color: '#999',
    textAlign: 'center' as const,
    marginTop: '6px',
    lineHeight: 1.35,
    padding: '0 4px',
  },
  labelTag: {
    fontSize: '7px',
    padding: '1px 3px',
    borderRadius: '4px',
    whiteSpace: 'nowrap' as const,
    lineHeight: '1.2',
    marginTop: '0',
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    background: 'rgba(0,0,0,0.45)',
  },
  modalPanel: {
    background: '#fff',
    borderRadius: '14px',
    maxWidth: '360px',
    width: '100%',
    maxHeight: 'min(85vh, 520px)',
    overflowY: 'auto' as const,
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    padding: '16px',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '14px',
  },
  modalTitle: {
    fontSize: '17px',
    fontWeight: 700,
    color: '#222',
    lineHeight: 1.3,
  },
  modalSymbol: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#888',
  },
  modalStatusPill: {
    display: 'inline-block',
    marginTop: '8px',
    fontSize: '12px',
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: '8px',
  },
  modalClose: {
    flexShrink: 0,
    border: 'none',
    background: 'transparent',
    fontSize: '26px',
    lineHeight: 1,
    color: '#999',
    cursor: 'pointer',
    padding: '0 4px',
    marginTop: '-4px',
  },
  modalSection: {
    marginBottom: '14px',
  },
  modalDt: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#666',
    marginBottom: '6px',
  },
  modalHero: {
    fontSize: '22px',
    fontWeight: 700,
    marginBottom: '6px',
  },
  modalDd: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#333',
  },
  modalDdMuted: {
    fontSize: '12px',
    color: '#888',
    lineHeight: 1.45,
    marginTop: '2px',
  },
  modalDdWrap: {
    fontSize: '13px',
    color: '#444',
    lineHeight: 1.5,
    wordBreak: 'break-word' as const,
  },
  modalFoot: {
    fontSize: '11px',
    color: '#aaa',
    margin: '0',
    lineHeight: 1.45,
    paddingTop: '4px',
    borderTop: '1px solid #eee',
  },
  arrow: {
    fontSize: '9px',
    margin: '0',
    display: 'inline-block',
    flexShrink: 1,
    alignSelf: 'center',
    lineHeight: '1',
    color: '#ddd',
  },
  legend: {
    display: 'flex',
    gap: '12px',
    rowGap: '6px',
    marginTop: '8px',
    justifyContent: 'center',
    flexWrap: 'wrap' as const,
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
