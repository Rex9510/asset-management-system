import React from 'react';
import { Position } from '../api/positions';

interface StockCardProps {
  position: Position;
}

const StockCard: React.FC<StockCardProps> = ({ position }) => {
  const isHolding = position.positionType === 'holding';
  const priceColor = getPriceColor(position.profitLossPercent ?? 0);
  const changeColor = getPriceColor(position.currentPrice != null && position.costPrice != null
    ? position.currentPrice - position.costPrice : 0);

  return (
    <div style={styles.card}>
      <div style={styles.topRow}>
        <div style={styles.nameGroup}>
          <span style={styles.stockName}>{position.stockName}</span>
          <span style={styles.stockCode}>{position.stockCode}</span>
        </div>
        <span style={{
          ...styles.tag,
          background: isHolding ? '#e6f7ff' : '#fff7e6',
          color: isHolding ? '#1890ff' : '#fa8c16',
        }}>
          {isHolding ? '持仓' : '关注'}
        </span>
      </div>

      <div style={styles.priceRow}>
        <span style={styles.currentPrice}>
          {position.currentPrice != null ? position.currentPrice.toFixed(2) : '--'}
        </span>
        {position.currentPrice != null && position.costPrice != null && isHolding && (
          <span style={{
            ...styles.changePercent,
            color: changeColor,
          }}>
            {formatPercent(position.profitLossPercent)}
          </span>
        )}
        {!isHolding && position.currentPrice != null && (
          <span style={styles.changePercent}>--</span>
        )}
      </div>

      {isHolding && (
        <>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>成本价</span>
            <span style={styles.detailValue}>
              {position.costPrice != null ? position.costPrice.toFixed(2) : '--'}
            </span>
            <span style={styles.detailLabel}>份额</span>
            <span style={styles.detailValue}>
              {position.shares != null ? position.shares : '--'}
            </span>
            <span style={styles.detailLabel}>持仓天数</span>
            <span style={styles.detailValue}>
              {position.holdingDays != null ? `${position.holdingDays}天` : '--'}
            </span>
          </div>
          <div style={styles.plRow}>
            <span style={styles.detailLabel}>盈亏</span>
            <span style={{ ...styles.plValue, color: priceColor }}>
              {formatProfitLoss(position.profitLoss)}
            </span>
            <span style={{ ...styles.plPercent, color: priceColor }}>
              {formatPercent(position.profitLossPercent)}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

function getPriceColor(value: number | null): string {
  if (value == null || value === 0) return '#333';
  return value > 0 ? '#ff4d4f' : '#52c41a';
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatProfitLoss(value: number | null | undefined): string {
  if (value == null) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
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
  tag: {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '10px',
    fontWeight: 500,
  },
  priceRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    marginBottom: '8px',
  },
  currentPrice: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#333',
  },
  changePercent: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#999',
  },
  detailRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
    flexWrap: 'wrap' as const,
  },
  detailLabel: {
    fontSize: '12px',
    color: '#999',
  },
  detailValue: {
    fontSize: '13px',
    color: '#333',
    marginRight: '8px',
  },
  plRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '4px',
  },
  plValue: {
    fontSize: '15px',
    fontWeight: 600,
  },
  plPercent: {
    fontSize: '13px',
    fontWeight: 500,
  },
};

export default StockCard;
