import React, { useEffect, useState } from 'react';
import { getValuation, ValuationData } from '../api/valuation';

interface ValuationTagProps {
  stockCode: string;
}

const zoneLabel: Record<string, string> = {
  low: '低估',
  fair: '合理',
  high: '高估',
};

const zoneColor: Record<string, string> = {
  low: '#52c41a',
  fair: '#667eea',
  high: '#ff4d4f',
};

const zoneBg: Record<string, string> = {
  low: 'rgba(82,196,26,0.10)',
  fair: 'rgba(102,126,234,0.10)',
  high: 'rgba(255,77,79,0.10)',
};

const ValuationTag: React.FC<ValuationTagProps> = ({ stockCode }) => {
  const [data, setData] = useState<ValuationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getValuation(stockCode)
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
  }, [stockCode]);

  if (loading) {
    return (
      <div style={styles.container}>
        <span style={styles.placeholder}>估值计算中...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={styles.container}>
        <span style={styles.placeholder}>估值计算中</span>
      </div>
    );
  }

  const showYears = data.dataYears < 10;

  return (
    <div style={styles.container}>
      <span
        style={{
          ...styles.tag,
          color: zoneColor[data.peZone],
          background: zoneBg[data.peZone],
        }}
      >
        PE {Math.round(data.pePercentile)}% {zoneLabel[data.peZone]}
      </span>
      <span
        style={{
          ...styles.tag,
          color: zoneColor[data.pbZone],
          background: zoneBg[data.pbZone],
        }}
      >
        PB {Math.round(data.pbPercentile)}% {zoneLabel[data.pbZone]}
      </span>
      {showYears && (
        <span style={styles.yearsTag}>{data.dataYears}年数据</span>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
    marginBottom: '8px',
  },
  tag: {
    fontSize: '12px',
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: '6px',
    lineHeight: '18px',
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap',
  },
  yearsTag: {
    fontSize: '12px',
    color: '#8b8fa3',
    padding: '3px 6px',
    borderRadius: '6px',
    background: 'rgba(139,143,163,0.08)',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
  },
  placeholder: {
    fontSize: '12px',
    color: '#8b8fa3',
    padding: '3px 8px',
    borderRadius: '6px',
    background: 'rgba(139,143,163,0.08)',
    lineHeight: '18px',
  },
};

export default ValuationTag;
