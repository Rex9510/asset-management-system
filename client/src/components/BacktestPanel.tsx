import React, { useState, useEffect, useCallback } from 'react';
import { runBacktest, BacktestResult, BacktestPeriodResult } from '../api/backtest';

interface BacktestPanelProps {
  stockCode: string;
  onClose: () => void;
}

const periodLabels: Record<string, string> = {
  '30d': '30天',
  '90d': '90天',
  '180d': '180天',
  '365d': '365天',
};

function formatPercent(value: number, showSign = true): string {
  const pct = (value * 100).toFixed(2);
  if (showSign && value > 0) return `+${pct}%`;
  return `${pct}%`;
}

function getReturnColor(value: number): string {
  if (value > 0) return '#ff4d4f';
  if (value < 0) return '#52c41a';
  return '#8b8fa3';
}

function getWinRateColor(rate: number): string {
  if (rate > 0.5) return '#52c41a';
  if (rate < 0.5) return '#ff4d4f';
  return '#8b8fa3';
}

const BacktestPanel: React.FC<BacktestPanelProps> = ({ stockCode, onClose }) => {
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchBacktest = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await runBacktest(stockCode);
      setResult(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [stockCode]);

  useEffect(() => {
    fetchBacktest();
  }, [fetchBacktest]);

  return (
    <div style={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="历史回测">
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerTitle}>📊 历史回测</div>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {/* Content */}
        <div style={styles.content}>
          {loading ? (
            <div style={styles.loadingState}>
              <div style={styles.loadingEmoji}>🔄</div>
              <div style={styles.loadingText}>正在计算回测数据...</div>
            </div>
          ) : error ? (
            <div style={styles.errorState}>
              <div style={styles.errorEmoji}>😞</div>
              <div style={styles.errorText}>回测计算失败</div>
              <button type="button" style={styles.retryButton} onClick={fetchBacktest}>🔄 重试</button>
            </div>
          ) : result ? (
            <>
              {/* Summary */}
              <div style={styles.summaryRow}>
                <div style={styles.summaryItem}>
                  <div style={styles.summaryLabel}>当前分位</div>
                  <div style={styles.summaryValue}>{result.currentPercentile.toFixed(1)}%</div>
                </div>
                <div style={styles.summaryItem}>
                  <div style={styles.summaryLabel}>匹配时点</div>
                  <div style={styles.summaryValue}>{result.matchingPoints}个</div>
                </div>
              </div>

              {/* Sample Warning */}
              {result.sampleWarning && (
                <div style={styles.warningBanner} role="alert">
                  ⚠️ 匹配时点不足5个，统计结果仅供参考
                </div>
              )}

              {/* Summary */}
              {result.summary && (
                <div style={styles.summaryCard}>
                  <span style={styles.summaryCardIcon}>💡</span>
                  <span style={styles.summaryCardText}>{result.summary}</span>
                </div>
              )}

              {/* Period Cards */}
              <div style={styles.periodGrid}>
                {result.results.map((pr: BacktestPeriodResult) => (
                  <div key={pr.period} style={styles.periodCard}>
                    <div style={styles.periodTitle}>{periodLabels[pr.period] || pr.period}</div>
                    <div style={styles.statRow}>
                      <span style={styles.statLabel}>胜率</span>
                      <span style={{ ...styles.statValue, color: getWinRateColor(pr.winRate) }}>
                        {(pr.winRate * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div style={styles.statRow}>
                      <span style={styles.statLabel}>平均收益</span>
                      <span style={{ ...styles.statValue, color: getReturnColor(pr.avgReturn) }}>
                        {formatPercent(pr.avgReturn)}
                      </span>
                    </div>
                    <div style={styles.statRow}>
                      <span style={styles.statLabel}>最大收益</span>
                      <span style={{ ...styles.statValue, color: getReturnColor(pr.maxReturn) }}>
                        {formatPercent(pr.maxReturn)}
                      </span>
                    </div>
                    <div style={styles.statRow}>
                      <span style={styles.statLabel}>最大亏损</span>
                      <span style={{ ...styles.statValue, color: getReturnColor(pr.maxLoss) }}>
                        {formatPercent(pr.maxLoss)}
                      </span>
                    </div>
                    <div style={styles.statRow}>
                      <span style={styles.statLabel}>中位收益</span>
                      <span style={{ ...styles.statValue, color: getReturnColor(pr.medianReturn) }}>
                        {formatPercent(pr.medianReturn)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Disclaimer */}
              <div style={styles.disclaimer}>{result.disclaimer}</div>
            </>
          ) : null}
        </div>
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
    background: 'rgba(0,0,0,0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    animation: 'fadeIn 0.2s ease',
  },
  modal: {
    background: '#fff',
    borderRadius: '16px 16px 0 0',
    width: '100%',
    maxWidth: '480px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    animation: 'slideUp 0.3s ease',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 16px 12px',
    borderBottom: '1px solid #f0f2f5',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#1a1a2e',
  },
  closeButton: {
    width: '44px',
    height: '44px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    fontSize: '18px',
    color: '#8b8fa3',
    cursor: 'pointer',
    borderRadius: '12px',
    flexShrink: 0,
  },
  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px',
  },
  summaryRow: {
    display: 'flex',
    gap: '12px',
    marginBottom: '12px',
  },
  summaryItem: {
    flex: 1,
    background: 'linear-gradient(135deg, rgba(102,126,234,0.08), rgba(118,75,162,0.08))',
    borderRadius: '12px',
    padding: '12px',
    textAlign: 'center' as const,
  },
  summaryLabel: {
    fontSize: '12px',
    color: '#8b8fa3',
    marginBottom: '4px',
  },
  summaryValue: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#1a1a2e',
  },
  warningBanner: {
    background: 'linear-gradient(135deg, #fff7e6, #fff3cd)',
    border: '1px solid rgba(212,136,6,0.15)',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '13px',
    color: '#d48806',
    marginBottom: '12px',
  },
  summaryCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    background: 'linear-gradient(135deg, rgba(102,126,234,0.06), rgba(118,75,162,0.06))',
    borderLeft: '3px solid #667eea',
    borderRadius: '0 10px 10px 0',
    padding: '12px 14px',
    marginBottom: '12px',
  },
  summaryCardIcon: {
    fontSize: '16px',
    lineHeight: '22px',
    flexShrink: 0,
  },
  summaryCardText: {
    fontSize: '14px',
    color: '#1a1a2e',
    lineHeight: '22px',
    fontWeight: 500,
  },
  periodGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '10px',
    marginBottom: '14px',
  },
  periodCard: {
    background: '#f8f9fc',
    borderRadius: '12px',
    padding: '12px',
    border: '1px solid #eef0f5',
  },
  periodTitle: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#1a1a2e',
    marginBottom: '8px',
    textAlign: 'center' as const,
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
  },
  statLabel: {
    fontSize: '12px',
    color: '#8b8fa3',
  },
  statValue: {
    fontSize: '13px',
    fontWeight: 600,
  },
  disclaimer: {
    fontSize: '12px',
    color: '#c0c4cc',
    textAlign: 'center' as const,
    paddingTop: '8px',
    borderTop: '1px solid #f0f2f5',
  },
  loadingState: {
    textAlign: 'center' as const,
    padding: '40px 0',
  },
  loadingEmoji: {
    fontSize: '32px',
    marginBottom: '12px',
  },
  loadingText: {
    fontSize: '14px',
    color: '#8b8fa3',
  },
  errorState: {
    textAlign: 'center' as const,
    padding: '40px 0',
  },
  errorEmoji: {
    fontSize: '40px',
    marginBottom: '12px',
  },
  errorText: {
    fontSize: '14px',
    color: '#8b8fa3',
    marginBottom: '16px',
  },
  retryButton: {
    padding: '10px 24px',
    border: 'none',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px',
  },
};

export default BacktestPanel;
