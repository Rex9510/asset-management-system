import React, { useState, useEffect, useCallback } from 'react';
import { Position } from '../api/positions';
import { getAnalysis, triggerAnalysis, getIndicators, AnalysisData, IndicatorData, SignalDirection } from '../api/analysis';
import { startDeepReport } from '../api/deepAnalysis';
import { deletePosition, createPosition } from '../api/positions';
import ValuationTag from './ValuationTag';
import StopLossIndicator from './StopLossIndicator';
import DeepReportModal from './DeepReportModal';
import BacktestPanel from './BacktestPanel';
import { showToast } from '../utils/toast';

interface StockCardProps {
  position: Position;
  onEdit?: () => void;
  onRemoved?: () => void;
}

const signalColors: Record<SignalDirection, { bg: string; color: string }> = {
  bullish: { bg: 'rgba(46,213,115,0.1)', color: '#2ed573' },
  neutral: { bg: 'rgba(255,165,2,0.1)', color: '#e6960a' },
  bearish: { bg: 'rgba(255,71,87,0.1)', color: '#ff4757' },
};
const signalEmoji: Record<SignalDirection, string> = { bullish: '🟢', neutral: '🟡', bearish: '🔴' };

const stageConfig: Record<string, { emoji: string; color: string; bg: string }> = {
  bottom: { emoji: '💎', color: '#2ed573', bg: 'rgba(46,213,115,0.1)' },
  rising: { emoji: '📈', color: '#ff4757', bg: 'rgba(255,71,87,0.1)' },
  main_wave: { emoji: '🔥', color: '#ff4757', bg: 'rgba(255,71,87,0.1)' },
  high: { emoji: '⚠️', color: '#ffa502', bg: 'rgba(255,165,2,0.1)' },
  falling: { emoji: '⚠️', color: '#ff4757', bg: 'rgba(255,71,87,0.1)' },
};
const stageLabels: Record<string, string> = {
  bottom: '底部震荡', rising: '上升趋势', main_wave: '主升浪中段', high: '高位震荡', falling: '下跌趋势',
};

function getConfidenceInfo(confidence: number): { emoji: string; label: string; color: string; bg: string } {
  if (confidence >= 80) return { emoji: '🟢', label: '高置信', color: '#2ed573', bg: 'rgba(46,213,115,0.1)' };
  if (confidence >= 60) return { emoji: '🟡', label: '中置信', color: '#e6960a', bg: 'rgba(255,165,2,0.1)' };
  return { emoji: '🔴', label: '低置信', color: '#ff4757', bg: 'rgba(255,71,87,0.1)' };
}

const StockCard: React.FC<StockCardProps> = ({ position, onEdit, onRemoved }) => {
  const [indicators, setIndicators] = useState<IndicatorData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [deepReportId, setDeepReportId] = useState<number | null>(null);
  const [generatingDeep, setGeneratingDeep] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);
  const [converting, setConverting] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const isHolding = position.positionType === 'holding';
  const priceColor = getPriceColor(position.profitLossPercent ?? 0);
  const changeColor = getPriceColor(position.currentPrice != null && position.costPrice != null
    ? position.currentPrice - position.costPrice : 0);

  useEffect(() => {
    let cancelled = false;
    getIndicators(position.stockCode).then(d => { if (!cancelled) setIndicators(d); }).catch(() => {});
    getAnalysis(position.stockCode).then(d => { if (!cancelled) setAnalysis(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [position.stockCode]);

  const handleDeepReport = useCallback(async () => {
    setGeneratingDeep(true);
    try {
      const result = await startDeepReport(position.stockCode);
      setDeepReportId(result.reportId);
    } catch { /* global interceptor */ } finally {
      setGeneratingDeep(false);
    }
  }, [position.stockCode]);

  const handleRefreshAnalysis = useCallback(async () => {
    setTriggering(true);
    try {
      const data = await triggerAnalysis(position.stockCode);
      setAnalysis(data);
    } catch { /* global interceptor */ } finally {
      setTriggering(false);
    }
  }, [position.stockCode]);

  const handleQuickBuy = useCallback(async () => {
    setConverting(true);
    try {
      await deletePosition(position.id);
      await createPosition({
        stockCode: position.stockCode,
        stockName: position.stockName,
        positionType: 'holding',
      });
      showToast('已转为持仓');
      onRemoved?.();
    } catch { /* global interceptor */ } finally {
      setConverting(false);
    }
  }, [position, onRemoved]);

  const handleUnwatch = useCallback(async () => {
    try {
      await deletePosition(position.id);
      showToast('已取消关注');
      onRemoved?.();
    } catch { /* global interceptor */ }
  }, [position.id, onRemoved]);

  // Watching mode: extract target price & upside from analysis
  const targetPriceRange = analysis?.targetPrice;
  const estimatedUpside = targetPriceRange && position.currentPrice
    ? {
        low: ((targetPriceRange.low - position.currentPrice) / position.currentPrice) * 100,
        high: ((targetPriceRange.high - position.currentPrice) / position.currentPrice) * 100,
      }
    : null;

  const signalEntries = indicators ? [
    { name: 'MA', signal: indicators.signals.ma },
    { name: 'MACD', signal: indicators.signals.macd },
    { name: 'KDJ', signal: indicators.signals.kdj },
    { name: 'RSI', signal: indicators.signals.rsi },
  ] : [];

  // Format estimate text
  const estimateText = analysis ? formatEstimateInline(analysis, isHolding) : null;

  // Stage & confidence info
  const stageInfo = analysis ? (stageConfig[analysis.stage] || stageConfig.bottom) : null;
  const stageLabel = analysis ? (stageLabels[analysis.stage] || analysis.stage) : null;
  const confInfo = analysis ? getConfidenceInfo(analysis.confidence) : null;

  return (
    <div style={styles.card}>
      {/* Header: name + price */}
      <div style={styles.topRow}>
        <div style={styles.nameGroup}>
          <span style={styles.stockName}>{position.stockName}</span>
          <span style={styles.stockCode}>{position.stockCode}</span>
        </div>
        <div style={styles.priceGroup}>
          <span style={{ ...styles.currentPrice, color: changeColor }}>
            {position.currentPrice != null ? position.currentPrice.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}
          </span>
          {position.currentPrice != null && position.costPrice != null && isHolding && (
            <span style={{ ...styles.changeTag, background: changeColor === '#ff4757' ? 'rgba(255,71,87,0.1)' : changeColor === '#2ed573' ? 'rgba(46,213,115,0.1)' : 'rgba(0,0,0,0.05)', color: changeColor }}>
              {formatPercent(position.profitLossPercent)}
            </span>
          )}
        </div>
      </div>

      {/* Valuation Tags */}
      <ValuationTag stockCode={position.stockCode} />

      {/* Watching mode: target price & upside */}
      {!isHolding && targetPriceRange && (
        <div style={styles.watchingInfo}>
          <div style={styles.watchingRow}>
            <span style={styles.watchingLabel}>🎯 目标价</span>
            <span style={styles.watchingValue}>{targetPriceRange.low.toFixed(2)} ~ {targetPriceRange.high.toFixed(2)}</span>
          </div>
          {estimatedUpside && (
            <div style={styles.watchingRow}>
              <span style={styles.watchingLabel}>📈 预估空间</span>
              <span style={{ ...styles.watchingValue, color: '#ff4757' }}>
                +{estimatedUpside.low.toFixed(1)}% ~ +{estimatedUpside.high.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Holding info grid */}
      {isHolding && (
        <div style={styles.infoGrid}>
          <div style={styles.infoItem}><div style={styles.infoLabel}>成本价</div><div style={styles.infoValue}>{position.costPrice != null ? position.costPrice.toFixed(2) : '--'}</div></div>
          <div style={styles.infoItem}><div style={styles.infoLabel}>持有</div><div style={styles.infoValue}>{position.shares != null ? `${position.shares}股` : '--'}</div></div>
          <div style={styles.infoItem}><div style={styles.infoLabel}>盈亏</div><div style={{ ...styles.infoValue, color: priceColor }}>{formatProfitLoss(position.profitLoss)}</div></div>
          <div style={styles.infoItem}><div style={styles.infoLabel}>盈亏比</div><div style={{ ...styles.infoValue, color: priceColor }}>{formatPercent(position.profitLossPercent)}</div></div>
        </div>
      )}

      {/* Stop Loss Indicator */}
      {position.stopLossPrice != null && (
        <StopLossIndicator stopLossPrice={position.stopLossPrice} currentPrice={position.currentPrice} />
      )}

      {/* Holding Duration + Estimate */}
      {isHolding && (
        <div style={styles.holdingDuration}>
          <div>📅 已持仓 <b style={{ color: '#333' }}>{position.holdingDays != null ? `${position.holdingDays}天` : '--'}</b></div>
          {estimateText && (
            <div style={{ fontSize: '11px', marginTop: '2px', color: (position.profitLossPercent ?? 0) >= 0 ? '#ff4757' : '#2ed573' }}>
              {(position.profitLossPercent ?? 0) >= 0 ? '📈' : '⏳'} {estimateText}
            </div>
          )}
        </div>
      )}

      {/* Technical Signal Tags (inline) */}
      {signalEntries.length > 0 && (
        <div style={styles.signalSection}>
          <div style={styles.signalTags}>
            {signalEntries.map(e => (
              <span key={e.name} style={{ ...styles.signalTag, background: signalColors[e.signal.direction].bg, color: signalColors[e.signal.direction].color }}>
                {signalEmoji[e.signal.direction]} {e.name} {e.signal.label}
              </span>
            ))}
          </div>
          <div
            style={styles.rawToggle}
            role="button"
            tabIndex={0}
            onClick={() => setShowRaw(!showRaw)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowRaw(!showRaw); } }}
          >
            <span style={{ fontSize: '11px', color: '#4a69bd' }}>{showRaw ? '收起原始数值' : '📊 查看原始数值 ›'}</span>
          </div>
          {showRaw && indicators && (
            <div style={styles.rawValues}>
              MA5:{fmt(indicators.ma.ma5)} MA20:{fmt(indicators.ma.ma20)} | MACD:{fmt(indicators.macd.histogram)} | KDJ:K{fmt(indicators.kdj.k)}/D{fmt(indicators.kdj.d)}/J{fmt(indicators.kdj.j)} | RSI6:{fmt(indicators.rsi.rsi6)}
            </div>
          )}
        </div>
      )}

      {/* AI Analysis Section (inline, matching prototype) */}
      <div style={styles.aiSection}>
        {analysis ? (
          <>
            {/* Phase tag + Refresh button */}
            <div style={styles.aiHeader}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: stageInfo?.color || '#999', display: 'inline-block' }} />
              <span style={{ ...styles.phaseTag, background: stageInfo?.bg, color: stageInfo?.color }}>
                {stageInfo?.emoji} {stageLabel}
              </span>
              <button
                type="button"
                style={styles.refreshBtn}
                onClick={handleRefreshAnalysis}
                disabled={triggering}
              >
                {triggering ? '分析中...' : '🔄 刷新'}
              </button>
            </div>

            {/* Risk Alerts */}
            {analysis.riskAlerts.length > 0 && analysis.riskAlerts.map((alert, i) => (
              <div key={i} style={styles.riskAlert}>⚠️ {alert}</div>
            ))}

            {/* Analysis text */}
            <div style={styles.aiText}>
              {isHolding ? renderHoldingAnalysis(analysis) : renderWatchingAnalysis(analysis)}
            </div>

            {/* Confidence + Reasoning link */}
            <div style={styles.aiFooter}>
              <span style={{ ...styles.confBadge, background: confInfo?.bg, color: confInfo?.color }}>
                {confInfo?.emoji} {confInfo?.label} {analysis.confidence}%
              </span>
              <span
                style={styles.reasoningLink}
                role="button"
                tabIndex={0}
                onClick={() => setShowReasoning(!showReasoning)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowReasoning(!showReasoning); } }}
              >
                {showReasoning ? '收起推理 ▲' : '查看推理 ›'}
              </span>
            </div>

            {/* Reasoning (expandable) */}
            {showReasoning && (
              <div style={styles.reasoningBox}>
                {analysis.reasoning}
              </div>
            )}
          </>
        ) : (
          <div style={styles.aiEmpty}>
            <span style={{ color: '#999', fontSize: '13px' }}>暂无AI分析数据</span>
            <button type="button" style={styles.refreshBtn} onClick={handleRefreshAnalysis} disabled={triggering}>
              {triggering ? 'AI分析中...' : '立即AI分析'}
            </button>
          </div>
        )}
      </div>

      {/* Action buttons: different for holding vs watching */}
      {isHolding ? (
        <>
          <div style={styles.actionRow}>
            <button type="button" style={styles.deepBtn} onClick={handleDeepReport} disabled={generatingDeep}>
              {generatingDeep ? '生成中...' : '📋 生成深度报告'}
            </button>
            <button type="button" style={styles.backtestBtn} onClick={() => setShowBacktest(true)}>
              📈 历史回测
            </button>
          </div>
          {onEdit && (
            <button type="button" style={styles.editBtn} onClick={onEdit} aria-label={`编辑${position.stockName}`}>
              ✏️ 编辑
            </button>
          )}
        </>
      ) : (
        <>
          <div style={styles.actionRow}>
            <button type="button" style={styles.buyBtn} onClick={handleQuickBuy} disabled={converting}>
              {converting ? '转换中...' : '🛒 买入建仓'}
            </button>
            <button type="button" style={styles.deepBtn} onClick={handleDeepReport} disabled={generatingDeep}>
              {generatingDeep ? '生成中...' : '📋 深度报告'}
            </button>
          </div>
          <div style={{ ...styles.actionRow, marginTop: '8px' }}>
            <button type="button" style={styles.backtestBtn} onClick={() => setShowBacktest(true)}>
              📈 历史回测
            </button>
            <button type="button" style={styles.unwatchBtn} onClick={handleUnwatch}>
              取消关注
            </button>
          </div>
        </>
      )}

      {deepReportId !== null && (
        <DeepReportModal stockCode={position.stockCode} reportId={deepReportId} onClose={() => setDeepReportId(null)} />
      )}
      {showBacktest && (
        <BacktestPanel stockCode={position.stockCode} onClose={() => setShowBacktest(false)} />
      )}
    </div>
  );
};

/* --- Render helpers for AI analysis text --- */

function renderHoldingAnalysis(analysis: AnalysisData): React.ReactNode {
  const actionLabels: Record<string, string> = { hold: '继续持有', add: '加仓', reduce: '减仓', clear: '清仓' };
  const actionLabel = actionLabels[analysis.actionRef] || analysis.actionRef;
  const parts: React.ReactNode[] = [];

  // Main recommendation line
  parts.push(
    <div key="main" style={{ marginBottom: '4px' }}>
      <b style={{ color: '#1a1a2e' }}>📊 参考方案：{actionLabel}</b>
      {analysis.targetPrice && <>，目标区间{analysis.targetPrice.low.toFixed(0)}-{analysis.targetPrice.high.toFixed(0)}</>}
      {analysis.spaceEstimate && <>。{analysis.spaceEstimate}</>}
    </div>
  );

  // Position strategy (profit/base position split)
  if (analysis.positionStrategy) {
    const ps = analysis.positionStrategy;
    parts.push(
      <div key="profit" style={{ marginTop: '2px' }}>
        💰 <b>利润仓（{ps.profitPosition.percent}%）</b>：{ps.profitPosition.action}
      </div>
    );
    parts.push(
      <div key="base" style={{ marginTop: '2px' }}>
        🏦 <b>底仓（{ps.basePosition.percent}%）</b>：{ps.basePosition.action}
      </div>
    );
  }

  // Batch plan
  if (analysis.batchPlan.length > 0 && !analysis.positionStrategy) {
    analysis.batchPlan.forEach((step, i) => {
      parts.push(
        <div key={`batch-${i}`} style={{ marginTop: '2px' }}>
          {step.action === 'buy' ? '🛒' : '💰'} <b>{step.action === 'buy' ? '买入' : '卖出'} {step.shares}股</b> 目标价{step.targetPrice.toFixed(2)}
          {step.note && <span style={{ color: '#999', fontSize: '12px' }}> {step.note}</span>}
        </div>
      );
    });
  }

  return <>{parts}</>;
}

function renderWatchingAnalysis(analysis: AnalysisData): React.ReactNode {
  const parts: React.ReactNode[] = [];

  // Key signals as narrative
  parts.push(
    <div key="main" style={{ marginBottom: '4px' }}>
      <b style={{ color: '#1a1a2e' }}>📊 参考建仓方案：</b>
      {analysis.keySignals.length > 0 ? analysis.keySignals.join('，') : ''}
    </div>
  );

  // Target price
  if (analysis.targetPrice) {
    parts.push(
      <div key="target" style={{ marginTop: '2px' }}>
        🎯 <b>目标价位</b>：{analysis.targetPrice.low.toFixed(0)}-{analysis.targetPrice.high.toFixed(0)}元
        {analysis.spaceEstimate && <>（{analysis.spaceEstimate}）</>}
      </div>
    );
  }

  // Batch plan for watching
  if (analysis.batchPlan.length > 0) {
    analysis.batchPlan.forEach((step, i) => {
      parts.push(
        <div key={`batch-${i}`} style={{ marginTop: '2px' }}>
          💰 <b>参考{step.action === 'buy' ? '买入' : '卖出'}区间</b>：{step.targetPrice.toFixed(2)}元 {step.shares}股
          {step.note && <span style={{ color: '#999', fontSize: '12px' }}> {step.note}</span>}
        </div>
      );
    });
  }

  return <>{parts}</>;
}

function getPriceColor(value: number | null): string {
  if (value == null || value === 0) return '#333';
  return value > 0 ? '#ff4757' : '#2ed573';
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

function formatEstimateInline(analysis: AnalysisData, isHolding: boolean): string | null {
  if (!isHolding) return null;
  if (analysis.recoveryEstimate) {
    try {
      const p = JSON.parse(analysis.recoveryEstimate);
      if (p.estimatedDays) return `参考预估：预计${p.estimatedDays[0]}-${p.estimatedDays[1]}个交易日可能回本`;
      if (p.note) return p.note;
      if (p.text) return p.text;
    } catch { return analysis.recoveryEstimate; }
  }
  if (analysis.profitEstimate) {
    try {
      const p = JSON.parse(analysis.profitEstimate);
      if (p.profitRange) return `参考预估：持有30天收益区间${p.profitRange[0]}%-${p.profitRange[1]}%`;
      if (p.note) return p.note;
      if (p.text) return p.text;
    } catch { return analysis.profitEstimate; }
  }
  return null;
}

function fmt(val: number | null): string {
  return val != null ? val.toFixed(1) : '--';
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '12px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    animation: 'fadeIn 0.3s ease',
    transition: 'all 0.2s ease',
  },
  topRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  nameGroup: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
  },
  stockName: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#1a1a2e',
  },
  stockCode: {
    fontSize: '12px',
    color: '#999',
  },
  priceGroup: {
    textAlign: 'right' as const,
  },
  currentPrice: {
    fontSize: '20px',
    fontWeight: 700,
    display: 'block',
  },
  changeTag: {
    fontSize: '13px',
    padding: '2px 8px',
    borderRadius: '4px',
    fontWeight: 600,
    display: 'inline-block',
    marginTop: '2px',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    gap: '8px',
    marginBottom: '12px',
    paddingBottom: '12px',
    borderBottom: '1px solid #f0f0f0',
  },
  infoItem: {
    textAlign: 'center' as const,
  },
  infoLabel: {
    fontSize: '11px',
    color: '#999',
    marginBottom: '2px',
  },
  infoValue: {
    fontSize: '13px',
    fontWeight: 600,
  },
  holdingDuration: {
    padding: '8px 12px',
    background: '#fafafa',
    borderRadius: '8px',
    marginBottom: '10px',
    fontSize: '12px',
    color: '#666',
  },
  signalSection: {
    background: '#f0f4ff',
    borderRadius: '8px',
    padding: '10px 12px',
    marginBottom: '10px',
  },
  signalTags: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap' as const,
    marginBottom: '4px',
  },
  signalTag: {
    fontSize: '11px',
    padding: '3px 8px',
    borderRadius: '6px',
    display: 'inline-block',
    fontWeight: 500,
  },
  rawToggle: {
    marginTop: '6px',
    cursor: 'pointer',
    minHeight: '28px',
    display: 'flex',
    alignItems: 'center',
  },
  rawValues: {
    fontSize: '10px',
    color: '#999',
    marginTop: '4px',
    lineHeight: '1.5',
  },
  /* AI Analysis Section */
  aiSection: {
    background: '#fafbff',
    borderRadius: '10px',
    padding: '12px',
    marginBottom: '10px',
    border: '1px solid #eef0f5',
  },
  aiHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '8px',
  },
  phaseTag: {
    fontSize: '12px',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: '10px',
  },
  refreshBtn: {
    fontSize: '12px',
    color: '#4a69bd',
    cursor: 'pointer',
    border: '1px solid #4a69bd',
    padding: '2px 10px',
    borderRadius: '12px',
    marginLeft: 'auto',
    background: 'transparent',
    minHeight: '28px',
    fontWeight: 500,
  },
  riskAlert: {
    fontSize: '12px',
    color: '#e67e22',
    background: 'rgba(230,126,34,0.08)',
    border: '1px solid rgba(230,126,34,0.2)',
    borderRadius: '6px',
    padding: '4px 8px',
    marginBottom: '8px',
    lineHeight: '1.5',
  },
  aiText: {
    fontSize: '13px',
    lineHeight: '1.6',
    color: '#555',
  },
  aiFooter: {
    fontSize: '11px',
    color: '#999',
    marginTop: '8px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  confBadge: {
    fontSize: '11px',
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: '4px',
  },
  reasoningLink: {
    fontSize: '12px',
    color: '#4a69bd',
    cursor: 'pointer',
    minHeight: '28px',
    display: 'flex',
    alignItems: 'center',
  },
  reasoningBox: {
    marginTop: '8px',
    padding: '10px',
    background: '#f0f2f5',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#666',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap' as const,
  },
  aiEmpty: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  /* Action Buttons */
  actionRow: {
    display: 'flex',
    gap: '8px',
    marginTop: '12px',
  },
  deepBtn: {
    flex: 1,
    padding: '10px',
    border: 'none',
    borderRadius: '8px',
    background: '#4a69bd',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px',
  },
  backtestBtn: {
    flex: 1,
    padding: '10px',
    border: 'none',
    borderRadius: '8px',
    background: '#9b59b6',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px',
  },
  editBtn: {
    display: 'block',
    width: '100%',
    marginTop: '8px',
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    background: '#fff',
    color: '#666',
    fontSize: '13px',
    cursor: 'pointer',
    textAlign: 'center' as const,
    minHeight: '44px',
  },
  watchingInfo: {
    background: 'rgba(74,105,189,0.06)',
    borderRadius: '8px',
    padding: '10px 12px',
    marginBottom: '10px',
  },
  watchingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '3px 0',
  },
  watchingLabel: {
    fontSize: '12px',
    color: '#666',
  },
  watchingValue: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#1a1a2e',
  },
  buyBtn: {
    flex: 1,
    padding: '10px',
    border: 'none',
    borderRadius: '8px',
    background: '#ff4757',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px',
  },
  unwatchBtn: {
    flex: 1,
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    background: '#fff',
    color: '#999',
    fontSize: '13px',
    cursor: 'pointer',
    minHeight: '44px',
  },
};

export default StockCard;
