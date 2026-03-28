import React from 'react';

export interface StopLossIndicatorProps {
  stopLossPrice: number;
  currentPrice: number | null;
}

const StopLossIndicator: React.FC<StopLossIndicatorProps> = ({ stopLossPrice, currentPrice }) => {
  const triggered = currentPrice != null && currentPrice <= stopLossPrice;

  return (
    <span
      style={{
        ...styles.tag,
        ...(triggered ? styles.triggered : styles.normal),
      }}
      role="status"
      aria-label={triggered ? `已触发止损 ${stopLossPrice}` : `止损线 ${stopLossPrice}`}
    >
      {triggered ? `⚠️ 已触发止损 ${stopLossPrice.toFixed(2)}` : `止损线 ${stopLossPrice.toFixed(2)}`}
    </span>
  );
};

const styles: Record<string, React.CSSProperties> = {
  tag: {
    display: 'inline-block',
    fontSize: '12px',
    fontWeight: 500,
    padding: '3px 8px',
    borderRadius: '6px',
    lineHeight: '1.4',
    marginTop: '4px',
  },
  normal: {
    background: '#f0f2f5',
    color: '#8b8fa3',
  },
  triggered: {
    background: '#fff1f0',
    color: '#ff4d4f',
    fontWeight: 600,
  },
};

export default StopLossIndicator;
