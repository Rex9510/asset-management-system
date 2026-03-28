import React, { useState, useEffect } from 'react';
import { getIndicators, getRiskAlerts, IndicatorData, RiskAlert, SignalDirection } from '../api/analysis';

interface TechnicalIndicatorsProps {
  stockCode: string;
}

const signalEmoji: Record<SignalDirection, string> = {
  bullish: '🟢',
  neutral: '🟡',
  bearish: '🔴',
};

const signalLabel: Record<SignalDirection, string> = {
  bullish: '看多',
  neutral: '震荡',
  bearish: '看空',
};

const TechnicalIndicators: React.FC<TechnicalIndicatorsProps> = ({ stockCode }) => {
  const [indicators, setIndicators] = useState<IndicatorData | null>(null);
  const [riskAlerts, setRiskAlerts] = useState<RiskAlert[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    Promise.all([
      getIndicators(stockCode).catch(() => null),
      getRiskAlerts(stockCode).catch(() => []),
    ]).then(([ind, alerts]) => {
      if (cancelled) return;
      if (ind) setIndicators(ind);
      else setError(true);
      setRiskAlerts(alerts as RiskAlert[]);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [stockCode]);

  if (loading) {
    return <div style={styles.loading}>指标计算中...</div>;
  }

  if (error || !indicators) {
    return <div style={styles.loading}>指标数据暂不可用</div>;
  }

  const signalEntries = [
    { name: 'MA均线', signal: indicators.signals.ma },
    { name: 'MACD', signal: indicators.signals.macd },
    { name: 'KDJ', signal: indicators.signals.kdj },
    { name: 'RSI', signal: indicators.signals.rsi },
  ];

  return (
    <div style={styles.container}>
      <div style={styles.title}>技术指标信号</div>

      {/* Signal lights */}
      <div style={styles.signalList}>
        {signalEntries.map((entry) => (
          <div key={entry.name} style={styles.signalRow}>
            <span style={styles.signalIcon}>
              {signalEmoji[entry.signal.direction]}
            </span>
            <span style={styles.signalName}>{entry.name}</span>
            <span style={{
              ...styles.signalDirection,
              color: entry.signal.direction === 'bullish' ? '#52c41a'
                : entry.signal.direction === 'bearish' ? '#ff4d4f' : '#faad14',
            }}>
              {signalLabel[entry.signal.direction]}
            </span>
            <span style={styles.signalLabel}>{entry.signal.label}</span>
          </div>
        ))}
      </div>

      {/* Risk alerts */}
      {riskAlerts.length > 0 && (
        <div style={styles.riskSection}>
          {riskAlerts.map((alert, i) => (
            <div key={i} style={styles.riskTag}>
              <span>⚠️ {alert.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Raw values toggle */}
      <div
        style={styles.toggleBtn}
        role="button"
        tabIndex={0}
        aria-label={showRaw ? '收起原始数值' : '展开原始数值'}
        onClick={() => setShowRaw(!showRaw)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setShowRaw(!showRaw);
          }
        }}
      >
        {showRaw ? '收起原始数值 ▲' : '查看原始数值 ▼'}
      </div>

      {showRaw && (
        <div style={styles.rawSection}>
          <div style={styles.rawGroup}>
            <div style={styles.rawGroupTitle}>MA均线</div>
            <div style={styles.rawRow}>
              <span>MA5: {fmt(indicators.ma.ma5)}</span>
              <span>MA10: {fmt(indicators.ma.ma10)}</span>
            </div>
            <div style={styles.rawRow}>
              <span>MA20: {fmt(indicators.ma.ma20)}</span>
              <span>MA60: {fmt(indicators.ma.ma60)}</span>
            </div>
          </div>
          <div style={styles.rawGroup}>
            <div style={styles.rawGroupTitle}>MACD</div>
            <div style={styles.rawRow}>
              <span>DIF: {fmt(indicators.macd.dif)}</span>
              <span>DEA: {fmt(indicators.macd.dea)}</span>
              <span>柱: {fmt(indicators.macd.histogram)}</span>
            </div>
          </div>
          <div style={styles.rawGroup}>
            <div style={styles.rawGroupTitle}>KDJ</div>
            <div style={styles.rawRow}>
              <span>K: {fmt(indicators.kdj.k)}</span>
              <span>D: {fmt(indicators.kdj.d)}</span>
              <span>J: {fmt(indicators.kdj.j)}</span>
            </div>
          </div>
          <div style={styles.rawGroup}>
            <div style={styles.rawGroupTitle}>RSI</div>
            <div style={styles.rawRow}>
              <span>RSI6: {fmt(indicators.rsi.rsi6)}</span>
              <span>RSI12: {fmt(indicators.rsi.rsi12)}</span>
              <span>RSI24: {fmt(indicators.rsi.rsi24)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function fmt(val: number | null): string {
  return val != null ? val.toFixed(2) : '--';
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginTop: '10px',
  },
  loading: {
    fontSize: '13px',
    color: '#8b8fa3',
    padding: '14px 0',
    textAlign: 'center' as const,
  },
  title: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#1a1a2e',
    marginBottom: '10px',
  },
  signalList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  signalRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap' as const,
    padding: '6px 10px',
    background: '#f8f9fc',
    borderRadius: '10px',
  },
  signalIcon: {
    fontSize: '14px',
  },
  signalName: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#1a1a2e',
    minWidth: '50px',
  },
  signalDirection: {
    fontSize: '12px',
    fontWeight: 600,
  },
  signalLabel: {
    fontSize: '12px',
    color: '#666',
    flex: 1,
  },
  riskSection: {
    marginTop: '10px',
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '6px',
  },
  riskTag: {
    fontSize: '12px',
    color: '#d48806',
    background: 'linear-gradient(135deg, #fff7e6, #fff3cd)',
    border: '1px solid rgba(212,136,6,0.15)',
    borderRadius: '8px',
    padding: '6px 10px',
  },
  toggleBtn: {
    fontSize: '12px',
    color: '#667eea',
    textAlign: 'center' as const,
    padding: '8px 0',
    cursor: 'pointer',
    minHeight: '44px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 500,
  },
  rawSection: {
    background: '#f8f9fc',
    borderRadius: '12px',
    padding: '12px',
    border: '1px solid #eef0f5',
  },
  rawGroup: {
    marginBottom: '8px',
  },
  rawGroupTitle: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#1a1a2e',
    marginBottom: '3px',
  },
  rawRow: {
    display: 'flex',
    gap: '14px',
    fontSize: '12px',
    color: '#555',
    flexWrap: 'wrap' as const,
  },
};

export default TechnicalIndicators;
