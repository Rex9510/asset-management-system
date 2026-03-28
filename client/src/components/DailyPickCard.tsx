import React, { useState, useEffect, useCallback } from 'react';
import { DailyPickMessage } from '../api/messages';
import { createPosition } from '../api/positions';
import apiClient from '../api/client';
import { showToast } from '../utils/toast';
import ValuationTag from './ValuationTag';

interface DailyPickCardProps {
  message: DailyPickMessage;
}

interface PickDetail {
  stockCode: string;
  stockName: string;
  period: string;
  periodLabel: string;
  reason: string;
  targetPriceRange: { low: number; high: number };
  estimatedUpside: number;
  estimatedUpsideRange?: { low: number; high: number };
  confidence?: number;
}

const periodConfig: Record<string, { bg: string; color: string }> = {
  short: { bg: '#fff3e0', color: '#ff9800' },
  mid: { bg: '#e8f5e9', color: '#2ed573' },
  long: { bg: '#e8f0fe', color: '#4a69bd' },
};

const DailyPickCard: React.FC<DailyPickCardProps> = ({ message }) => {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [changePercent, setChangePercent] = useState<number | null>(null);
  const [watched, setWatched] = useState(false);
  const [bought, setBought] = useState(false);

  let pick: PickDetail | null = null;
  try {
    pick = JSON.parse(message.detail);
  } catch {
    pick = null;
  }

  const stockCode = pick?.stockCode?.replace(/\.\w+$/, '') || '';

  useEffect(() => {
    if (!stockCode) return;
    let cancelled = false;
    apiClient.get<{ quote: { price: number; changePercent?: number } }>(`/market/quote/${stockCode}`)
      .then(res => {
        if (!cancelled) {
          setCurrentPrice(res.data.quote.price);
          if (res.data.quote.changePercent != null) setChangePercent(res.data.quote.changePercent);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [stockCode]);

  const handleWatch = useCallback(async () => {
    if (!pick || watched) return;
    try {
      const cleanCode = pick.stockCode.replace(/\.\w+$/, '');
      await createPosition({ stockCode: cleanCode, stockName: pick.stockName, positionType: 'watching' });
      setWatched(true);
      showToast('已加入关注');
    } catch { /* global interceptor */ }
  }, [pick, watched]);

  const handleQuickBuy = useCallback(async () => {
    if (!pick || currentPrice == null || bought) return;
    try {
      const cleanCode = pick.stockCode.replace(/\.\w+$/, '');
      await createPosition({
        stockCode: cleanCode,
        stockName: pick.stockName,
        positionType: 'holding',
        costPrice: currentPrice,
        shares: 100,
        buyDate: new Date().toISOString().slice(0, 10),
      });
      setBought(true);
      showToast('已快速买入（100股）');
    } catch { /* global interceptor */ }
  }, [pick, currentPrice, bought]);

  if (!pick) return null;

  const pCfg = periodConfig[pick.period] || periodConfig.mid;
  const isUp = changePercent != null ? changePercent >= 0 : true;
  const priceColor = isUp ? '#ff4757' : '#2ed573';
  const changeBg = isUp ? 'rgba(255,71,87,0.1)' : 'rgba(46,213,115,0.1)';
  const changeColor = isUp ? '#ff4757' : '#2ed573';

  return (
    <div style={styles.pickItem}>
      {/* Period tag */}
      <div style={{ marginBottom: '6px' }}>
        <span style={{ ...styles.periodTag, background: pCfg.bg, color: pCfg.color }}>
          {pick.periodLabel || pick.period}
        </span>
      </div>

      {/* Name + Price row */}
      <div style={styles.nameRow}>
        <div>
          <span style={styles.stockName}>{pick.stockName}</span>
          <span style={styles.stockCode}>{stockCode}</span>
        </div>
        <div style={{ textAlign: 'right' as const }}>
          <div style={{ ...styles.price, color: priceColor }}>
            {currentPrice != null ? currentPrice.toFixed(2) : '--'}
          </div>
          {changePercent != null && (
            <span style={{ ...styles.changeTag, background: changeBg, color: changeColor }}>
              {changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      {/* Valuation Tags */}
      <div style={{ marginBottom: '6px' }}>
        <ValuationTag stockCode={stockCode} />
      </div>

      {/* Target price + upside box */}
      <div style={styles.targetBox}>
        <div style={{ flex: 1, textAlign: 'center' as const }}>
          <div style={styles.targetLabel}>目标价位</div>
          <div style={styles.targetValue}>
            {pick.targetPriceRange
              ? `${pick.targetPriceRange.low} - ${pick.targetPriceRange.high}`
              : '--'}
          </div>
        </div>
        <div style={{ flex: 1, textAlign: 'center' as const }}>
          <div style={styles.targetLabel}>预估上升空间</div>
          <div style={styles.targetValue}>
            {pick.estimatedUpsideRange
              ? `+${pick.estimatedUpsideRange.low.toFixed(1)}% ~ +${pick.estimatedUpsideRange.high.toFixed(1)}%`
              : pick.estimatedUpside != null ? `+${pick.estimatedUpside.toFixed(1)}%` : '--'}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={styles.actionRow}>
        <button
          type="button"
          style={watched ? styles.watchBtnDone : styles.watchBtn}
          onClick={handleWatch}
          disabled={watched}
        >
          {watched ? '✓ 已关注' : '👁 加入关注'}
        </button>
        <button
          type="button"
          style={bought ? styles.buyBtnDone : styles.buyBtn}
          onClick={handleQuickBuy}
          disabled={bought}
        >
          {bought ? '✓ 已买入' : '🛒 快速买入'}
        </button>
      </div>

      {/* Confidence + view analysis */}
      <div style={styles.bottomRow}>
        {pick.confidence != null && (
          <span style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: '4px',
            background: pick.confidence >= 80 ? 'rgba(46,213,115,0.1)' : pick.confidence >= 60 ? 'rgba(255,165,2,0.1)' : 'rgba(255,71,87,0.1)',
            color: pick.confidence >= 80 ? '#2ed573' : pick.confidence >= 60 ? '#e6960a' : '#ff4757',
          }}>
            {pick.confidence >= 80 ? '🟢 高' : pick.confidence >= 60 ? '🟡 中' : '🔴 低'}置信 {pick.confidence}%
          </span>
        )}
        <span style={{ fontSize: '12px', color: '#4a69bd', cursor: 'pointer', marginLeft: 'auto' }}>
          查看完整分析 ›
        </span>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  pickItem: {
    borderBottom: '1px dashed #dde3f0',
    paddingBottom: '12px',
    marginBottom: '12px',
  },
  periodTag: {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '10px',
    fontWeight: 600,
  },
  nameRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  stockName: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#333',
  },
  stockCode: {
    fontSize: '12px',
    color: '#999',
    marginLeft: '6px',
  },
  price: {
    fontSize: '20px',
    fontWeight: 700,
  },
  changeTag: {
    fontSize: '13px',
    padding: '2px 8px',
    borderRadius: '4px',
  },
  targetBox: {
    display: 'flex',
    gap: '12px',
    padding: '6px 10px',
    background: 'rgba(74,105,189,0.08)',
    borderRadius: '8px',
    marginBottom: '8px',
  },
  targetLabel: {
    fontSize: '10px',
    color: '#999',
  },
  targetValue: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#ff4757',
  },
  actionRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '6px',
  },
  watchBtn: {
    flex: 1,
    padding: '7px',
    border: '1px solid #4a69bd',
    borderRadius: '6px',
    background: '#fff',
    color: '#4a69bd',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px',
  },
  watchBtnDone: {
    flex: 1,
    padding: '7px',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    background: '#f5f5f5',
    color: '#999',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'default',
    minHeight: '44px',
  },
  buyBtn: {
    flex: 1,
    padding: '7px',
    border: 'none',
    borderRadius: '6px',
    background: '#ff4757',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px',
  },
  buyBtnDone: {
    flex: 1,
    padding: '7px',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    background: '#f5f5f5',
    color: '#999',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'default',
    minHeight: '44px',
  },
  bottomRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
};

export default DailyPickCard;
