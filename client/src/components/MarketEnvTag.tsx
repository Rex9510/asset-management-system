import React, { useEffect, useState } from 'react';
import { getMarketEnv, MarketEnvData } from '../api/marketEnv';

const envColor: Record<string, string> = {
  bull: '#2ed573',
  sideways: '#ffa502',
  bear: '#ff4757',
};

const envBg: Record<string, string> = {
  bull: 'rgba(46,213,115,0.2)',
  sideways: 'rgba(255,165,2,0.2)',
  bear: 'rgba(255,71,87,0.2)',
};

const envDescription: Record<string, string> = {
  bull: '趋势向上，多头行情，整体市场做多情绪浓厚，适合积极持仓进攻。',
  sideways: '横盘震荡，市场方向不明，保持中等仓位，等待方向选择。',
  bear: '趋势向下，空头行情，建议控制仓位，谨慎操作等待企稳。',
};

const MarketEnvTag: React.FC = () => {
  const [data, setData] = useState<MarketEnvData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getMarketEnv()
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

  if (loading) {
    return (
      <span style={styles.placeholder} data-testid="marketenv-loading">
        大盘计算中...
      </span>
    );
  }

  if (error || !data) {
    return null;
  }

  const env = data.environment;
  const color = envColor[env] || '#1890ff';
  const bg = envBg[env] || 'rgba(24,144,255,0.12)';
  const desc = envDescription[env] || '';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowModal(!showModal);
  };

  return (
    <>
      <span
        style={{ ...styles.tag, color, background: bg, cursor: 'pointer' }}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowModal(!showModal); }}
        data-testid="marketenv-tag"
      >
        ⚖️ {data.label} ›
      </span>

      {showModal && data && (
        <div style={styles.overlay} onClick={() => setShowModal(false)}>
          <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
            <div style={styles.header}>
              <strong style={{ color }}>⚖️ 大盘环境：{data.label}</strong>
              <button
                type="button"
                style={styles.closeBtn}
                onClick={() => setShowModal(false)}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <div style={styles.body}>
              <p style={styles.descText}>{desc}</p>
              <p style={styles.descHint}>
                💡 <strong>大盘环境判断</strong>：基于近期均线趋势和涨跌幅统计，判断当前市场整体是多头/震荡/空头行情，帮助你把握整体仓位策略。
              </p>
              {data.riskTip && (
                <p style={styles.riskTip}>{data.riskTip}</p>
              )}
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
    whiteSpace: 'nowrap' as const,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
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

export default MarketEnvTag;
