import React, { useEffect, useState } from 'react';
import { getRotationCurrent, RotationStatus } from '../api/rotation';

const phaseColor: Record<string, string> = {
  P1: '#6c9bff',
  P2: '#ffa502',
  P3: '#c39bdf',
};

const phaseBg: Record<string, string> = {
  P1: 'rgba(74,105,189,0.2)',
  P2: 'rgba(255,165,2,0.2)',
  P3: 'rgba(155,89,182,0.2)',
};

const phaseDescription: Record<string, string> = {
  P1: '科技成长板块（半导体/互联网/新能源）近期走势最强，涨幅领先，是当前市场的主线行情。建议重点关注科技方向机会。',
  P2: '周期品类（有色/煤炭/化工/原油）近期走势最强，涨幅领先。通常对应经济复苏/通胀周期，周期品占优。',
  P3: '消费白酒板块近期走势最强，防守性突出。通常对应市场调整期，资金抱团消费避险。',
};

const RotationTag: React.FC = () => {
  const [data, setData] = useState<RotationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showDesc, setShowDesc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getRotationCurrent()
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const toggleDesc = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDesc(!showDesc);
  };

  if (loading) {
    return (
      <span style={styles.placeholder} data-testid="rotation-loading">
        轮动计算中...
      </span>
    );
  }

  if (error || !data || !data.currentPhase) {
    return null;
  }

  const phase = data.currentPhase;
  const color = phaseColor[phase] || '#667eea';
  const bg = phaseBg[phase] || 'rgba(102,126,234,0.12)';

  return (
    <>
      <span
        style={{ ...styles.tag, color, background: bg, cursor: 'pointer' }}
        data-testid="rotation-tag"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setShowDesc(!showDesc);
          }
        }}
        onClick={toggleDesc}
      >
        {phase} {data.phaseLabel} 🔄 ›
      </span>
      {showDesc && data && (
        <div style={styles.overlay} onClick={() => setShowDesc(false)}>
          <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
            <div style={styles.header}>
              <strong style={{ color }}>{data.currentPhase} {data.phaseLabel}</strong>
              <button
                type="button"
                style={styles.closeBtn}
                onClick={() => setShowDesc(false)}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <div style={styles.body}>
              <p style={styles.descText}>
                {phaseDescription[data.currentPhase]}
              </p>
              <p style={styles.descHint}>
                💡 <strong>板块轮动分析</strong>：通过监测科技/周期/消费三大板块ETF近20日涨幅+成交量强度，自动判断当前哪个风格占优，帮助你把握市场主线。
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const styles: Record<string, React.CSSProperties> = {
  tag: {
    fontSize: '10px',
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: '10px',
    lineHeight: '16px',
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
  },
  placeholder: {
    fontSize: '10px',
    color: '#aaa',
    padding: '3px 8px',
    borderRadius: '10px',
    background: 'rgba(155,155,155,0.15)',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
  },
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '16px',
  },
  panel: {
    background: '#fff',
    borderRadius: '16px',
    padding: '16px',
    width: '100%',
    maxWidth: '340px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  closeBtn: {
    width: '28px',
    height: '28px',
    border: 'none',
    background: 'rgba(0,0,0,0.05)',
    fontSize: '14px',
    color: '#666',
    cursor: 'pointer',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    color: '#333',
  },
  descText: {
    margin: '0 0 8px 0',
    fontSize: '14px',
    lineHeight: '1.6',
  },
  descHint: {
    margin: '8px 0 0 0',
    fontSize: '12px',
    lineHeight: '1.6',
    color: '#666',
  },
};

export default RotationTag;
