import React, { useState } from 'react';
import { DailyPickMessage } from '../api/messages';

interface DailyPickCardProps {
  message: DailyPickMessage;
}

interface PickItem {
  stockCode: string;
  stockName: string;
  cycle: 'short' | 'medium' | 'long';
  reason: string;
  targetPriceRange: { low: number; high: number };
  upsidePercent: number;
  reasoning: string;
}

const cycleLabels: Record<string, string> = {
  short: '短期',
  medium: '中期',
  long: '中长期',
};

const cycleColors: Record<string, string> = {
  short: '#ff7a45',
  medium: '#1890ff',
  long: '#722ed1',
};

const DailyPickCard: React.FC<DailyPickCardProps> = ({ message }) => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  let picks: PickItem[] = [];
  try {
    const parsed = JSON.parse(message.detail);
    picks = parsed.picks || [];
  } catch {
    picks = [];
  }

  if (picks.length === 0) return null;

  return (
    <div>
      {picks.map((pick, index) => (
        <div key={pick.stockCode} style={styles.card}>
          <div
            style={styles.clickArea}
            role="button"
            tabIndex={0}
            aria-label={`展开${pick.stockName}分析详情`}
            onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setExpandedIndex(expandedIndex === index ? null : index);
              }
            }}
          >
            <div style={styles.topRow}>
              <div style={styles.nameGroup}>
                <span style={styles.stockName}>{pick.stockName}</span>
                <span style={styles.stockCode}>{pick.stockCode}</span>
              </div>
              <span style={{
                ...styles.cycleTag,
                background: cycleColors[pick.cycle] || '#1890ff',
              }}>
                {cycleLabels[pick.cycle] || pick.cycle}
              </span>
            </div>

            <div style={styles.reasonRow}>
              <span style={styles.reasonLabel}>关注理由：</span>
              <span style={styles.reasonText}>{pick.reason}</span>
            </div>

            <div style={styles.metricsRow}>
              <div style={styles.metric}>
                <span style={styles.metricLabel}>目标价位</span>
                <span style={styles.metricValue}>
                  {pick.targetPriceRange.low.toFixed(2)} - {pick.targetPriceRange.high.toFixed(2)}
                </span>
              </div>
              <div style={styles.metric}>
                <span style={styles.metricLabel}>上升空间</span>
                <span style={{ ...styles.metricValue, color: '#ff4d4f' }}>
                  +{pick.upsidePercent.toFixed(1)}%
                </span>
              </div>
            </div>

            <div style={styles.expandHint}>
              {expandedIndex === index ? '收起详情 ▲' : '查看详情 ▼'}
            </div>
          </div>

          {expandedIndex === index && (
            <div style={styles.reasoning}>
              <div style={styles.reasoningTitle}>完整推理过程</div>
              <div style={styles.reasoningText}>{pick.reasoning}</div>
            </div>
          )}

          <div style={styles.disclaimer}>
            以上内容仅供参考，不构成投资建议
          </div>
        </div>
      ))}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    borderLeft: '4px solid #1890ff',
  },
  clickArea: {
    cursor: 'pointer',
    minHeight: '44px',
  },
  topRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  nameGroup: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
  },
  stockName: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#333',
  },
  stockCode: {
    fontSize: '12px',
    color: '#999',
  },
  cycleTag: {
    fontSize: '11px',
    padding: '2px 10px',
    borderRadius: '10px',
    color: '#fff',
    fontWeight: 500,
  },
  reasonRow: {
    marginBottom: '8px',
  },
  reasonLabel: {
    fontSize: '12px',
    color: '#999',
  },
  reasonText: {
    fontSize: '13px',
    color: '#333',
    lineHeight: '1.5',
  },
  metricsRow: {
    display: 'flex',
    gap: '24px',
    marginBottom: '8px',
  },
  metric: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  metricLabel: {
    fontSize: '11px',
    color: '#999',
    marginBottom: '2px',
  },
  metricValue: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#333',
  },
  expandHint: {
    fontSize: '12px',
    color: '#1890ff',
    textAlign: 'center' as const,
    padding: '4px 0',
  },
  reasoning: {
    background: '#f9f9f9',
    borderRadius: '8px',
    padding: '12px',
    marginTop: '8px',
    marginBottom: '8px',
  },
  reasoningTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#333',
    marginBottom: '6px',
  },
  reasoningText: {
    fontSize: '13px',
    color: '#555',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap' as const,
  },
  disclaimer: {
    fontSize: '11px',
    color: '#bbb',
    textAlign: 'center' as const,
    marginTop: '8px',
    borderTop: '1px solid #f0f0f0',
    paddingTop: '8px',
  },
};

export default DailyPickCard;
