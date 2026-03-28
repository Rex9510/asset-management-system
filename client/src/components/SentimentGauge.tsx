import React from 'react';
import { SentimentData } from '../api/sentiment';

interface SentimentGaugeProps {
  data: SentimentData;
  onClose: () => void;
}

const SentimentGauge: React.FC<SentimentGaugeProps> = ({ data, onClose }) => {
  const score = data.score ?? 0;

  const getScoreColor = (s: number): string => {
    if (s < 25) return '#ff4d4f';
    if (s < 45) return '#fa8c16';
    if (s < 55) return '#faad14';
    if (s < 75) return '#52c41a';
    return '#13c2c2';
  };

  const scoreColor = getScoreColor(score);

  return (
    <div
      style={styles.overlay}
      onClick={onClose}
      data-testid="sentiment-gauge-overlay"
    >
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        data-testid="sentiment-gauge"
      >
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.headerTitle}>市场情绪指数</span>
          <button
            type="button"
            style={styles.closeBtn}
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Score Display */}
        <div style={styles.scoreSection}>
          <span style={styles.emoji}>{data.emoji}</span>
          <span style={{ ...styles.scoreValue, color: scoreColor }}>{score}</span>
          <span style={{ ...styles.label, color: scoreColor }}>{data.label}</span>
        </div>

        {/* Gauge Bar */}
        <div style={styles.gaugeContainer}>
          <div style={styles.gaugeTrack}>
            <div
              style={{
                ...styles.gaugeFill,
                width: `${score}%`,
              }}
              data-testid="sentiment-gauge-fill"
            />
            <div
              style={{
                ...styles.gaugeIndicator,
                left: `${score}%`,
              }}
            />
          </div>
          <div style={styles.gaugeLabels}>
            <span style={styles.gaugeLabelLeft}>😱 恐慌</span>
            <span style={styles.gaugeLabelRight}>贪婪 🤑</span>
          </div>
        </div>

        {/* Components Breakdown */}
        {data.components && (
          <div style={styles.components}>
            <div style={styles.componentTitle}>构成因子</div>
            <div style={styles.componentRow}>
              <span style={styles.componentLabel}>成交量/均量比</span>
              <span style={styles.componentValue}>
                {data.components.volumeRatio.toFixed(2)}
              </span>
            </div>
            <div style={styles.componentRow}>
              <span style={styles.componentLabel}>上证涨跌幅</span>
              <span style={{
                ...styles.componentValue,
                color: data.components.shChangePercent >= 0 ? '#ff4d4f' : '#52c41a',
              }}>
                {data.components.shChangePercent >= 0 ? '+' : ''}
                {data.components.shChangePercent.toFixed(2)}%
              </span>
            </div>
            <div style={styles.componentRow}>
              <span style={styles.componentLabel}>沪深300涨跌幅</span>
              <span style={{
                ...styles.componentValue,
                color: data.components.hs300ChangePercent >= 0 ? '#ff4d4f' : '#52c41a',
              }}>
                {data.components.hs300ChangePercent >= 0 ? '+' : ''}
                {data.components.hs300ChangePercent.toFixed(2)}%
              </span>
            </div>
          </div>
        )}

        {/* Updated At */}
        {data.updatedAt && (
          <div style={styles.updatedAt}>
            更新于 {new Date(data.updatedAt).toLocaleString('zh-CN')}
          </div>
        )}

        {/* Bottom close button for easier mobile closing */}
        <button
          type="button"
          style={styles.bottomCloseBtn}
          onClick={onClose}
        >
          关闭
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    animation: 'fadeIn 0.2s ease',
    padding: '16px',
  },
  panel: {
    background: '#fff',
    borderRadius: '16px',
    padding: '20px',
    width: '100%',
    maxWidth: '340px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
    animation: 'slideUp 0.3s ease',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  headerTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#1a1a2e',
  },
  closeBtn: {
    width: '32px',
    height: '32px',
    border: 'none',
    background: 'rgba(0,0,0,0.05)',
    fontSize: '16px',
    color: '#666',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    transition: 'all 0.2s ease',
  },
  bottomCloseBtn: {
    width: '100%',
    padding: '12px',
    marginTop: '16px',
    border: 'none',
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    color: '#fff',
    fontSize: '15px',
    fontWeight: '600',
    borderRadius: '12px',
    cursor: 'pointer',
    minHeight: '44px',
  },
  scoreSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '4px',
    marginBottom: '20px',
  },
  emoji: {
    fontSize: '36px',
    lineHeight: '44px',
  },
  scoreValue: {
    fontSize: '42px',
    fontWeight: 800,
    lineHeight: '48px',
    letterSpacing: '-1px',
  },
  label: {
    fontSize: '14px',
    fontWeight: 600,
  },
  gaugeContainer: {
    marginBottom: '20px',
  },
  gaugeTrack: {
    position: 'relative' as const,
    height: '10px',
    borderRadius: '5px',
    background: 'linear-gradient(to right, #ff4d4f, #fa8c16, #faad14, #52c41a, #13c2c2)',
    overflow: 'visible',
  },
  gaugeFill: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    height: '100%',
    borderRadius: '5px 0 0 5px',
    background: 'transparent',
  },
  gaugeIndicator: {
    position: 'absolute' as const,
    top: '-3px',
    width: '4px',
    height: '16px',
    background: '#1a1a2e',
    borderRadius: '2px',
    transform: 'translateX(-2px)',
    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
  },
  gaugeLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '6px',
  },
  gaugeLabelLeft: {
    fontSize: '12px',
    color: '#ff4d4f',
    fontWeight: 500,
  },
  gaugeLabelRight: {
    fontSize: '12px',
    color: '#13c2c2',
    fontWeight: 500,
  },
  components: {
    background: 'rgba(102,126,234,0.06)',
    borderRadius: '12px',
    padding: '14px',
    marginBottom: '12px',
  },
  componentTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#667eea',
    marginBottom: '10px',
  },
  componentRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
  },
  componentLabel: {
    fontSize: '13px',
    color: '#666',
  },
  componentValue: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#1a1a2e',
  },
  updatedAt: {
    fontSize: '12px',
    color: '#999',
    textAlign: 'center' as const,
  },
};

export default SentimentGauge;
