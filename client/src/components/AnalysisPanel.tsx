import React, { useState, useEffect, useCallback } from 'react';
import { getAnalysis, triggerAnalysis, AnalysisData } from '../api/analysis';
import { startDeepReport } from '../api/deepAnalysis';
import TechnicalIndicators from './TechnicalIndicators';
import DeepReportModal from './DeepReportModal';
import BacktestPanel from './BacktestPanel';

interface AnalysisPanelProps {
  stockCode: string;
}

const stageLabels: Record<string, string> = {
  bottom: '底部',
  rising: '上升',
  main_wave: '主升浪',
  high: '高位',
  falling: '下跌',
};

const actionLabels: Record<string, string> = {
  hold: '持有',
  add: '加仓',
  reduce: '减仓',
  clear: '清仓',
};

function getConfidenceInfo(confidence: number): { emoji: string; label: string; color: string; desc: string } {
  if (confidence >= 80) return { emoji: '🟢', label: '高置信', color: '#52c41a', desc: '多维度数据一致，参考价值较高' };
  if (confidence >= 60) return { emoji: '🟡', label: '中置信', color: '#faad14', desc: '部分数据支撑，仅供参考' };
  return { emoji: '🔴', label: '低置信', color: '#ff4d4f', desc: '数据不足或矛盾，谨慎参考' };
}

const AnalysisPanel: React.FC<AnalysisPanelProps> = ({ stockCode }) => {
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [deepReportId, setDeepReportId] = useState<number | null>(null);
  const [generatingDeep, setGeneratingDeep] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    getAnalysis(stockCode)
      .then((data) => {
        if (cancelled) return;
        setAnalysis(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [stockCode]);

  const handleTrigger = useCallback(async () => {
    setTriggering(true);
    try {
      const data = await triggerAnalysis(stockCode);
      setAnalysis(data);
      setError(false);
    } catch {
      // keep showing old data if trigger fails
    } finally {
      setTriggering(false);
    }
  }, [stockCode]);

  const handleDeepReport = useCallback(async () => {
    setGeneratingDeep(true);
    try {
      const result = await startDeepReport(stockCode);
      setDeepReportId(result.reportId);
    } catch {
      // error handled by global interceptor
    } finally {
      setGeneratingDeep(false);
    }
  }, [stockCode]);

  if (loading) {
    return <div style={styles.loading}>分析加载中...</div>;
  }

  if (error || !analysis) {
    return (
      <div style={styles.loading}>
        <div>暂无分析数据</div>
        <button
          type="button"
          style={styles.triggerButton}
          onClick={handleTrigger}
          disabled={triggering}
        >
          {triggering ? 'AI分析中...' : '立即AI分析'}
        </button>
      </div>
    );
  }

  const conf = getConfidenceInfo(analysis.confidence);

  return (
    <div style={styles.container}>
      {/* Stage & Space Estimate */}
      <div style={styles.headerRow}>
        <span style={styles.stageTag}>
          {stageLabels[analysis.stage] || analysis.stage}阶段
        </span>
        {analysis.spaceEstimate && (
          <span style={styles.spaceEstimate}>空间预估：{analysis.spaceEstimate}</span>
        )}
      </div>

      {/* Confidence */}
      <div
        style={styles.confidenceRow}
        role="button"
        tabIndex={0}
        aria-label="展开推理过程"
        onClick={() => setShowReasoning(!showReasoning)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setShowReasoning(!showReasoning);
          }
        }}
      >
        <span style={{ ...styles.confidenceBadge, background: conf.color }}>
          {conf.emoji} {conf.label} {analysis.confidence}%
        </span>
        <span style={styles.confidenceDesc}>{conf.desc}</span>
        <span style={styles.expandArrow}>{showReasoning ? '▲' : '▼'}</span>
      </div>

      {/* Reasoning (expandable) */}
      {showReasoning && (
        <div style={styles.reasoningBox}>
          <div style={styles.reasoningTitle}>推理过程</div>
          <div style={styles.reasoningText}>{analysis.reasoning}</div>
        </div>
      )}

      {/* Key Signals */}
      {analysis.keySignals.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>关键信号</div>
          {analysis.keySignals.map((signal, i) => (
            <div key={i} style={styles.signalItem}>• {signal}</div>
          ))}
        </div>
      )}

      {/* Operation Reference */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>操作参考方案</div>
        <span style={styles.actionTag}>
          {actionLabels[analysis.actionRef] || analysis.actionRef}
        </span>
      </div>

      {/* Target Price */}
      {analysis.targetPrice && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>目标价位</div>
          <span style={styles.targetPrice}>
            {analysis.targetPrice.low.toFixed(2)} - {analysis.targetPrice.high.toFixed(2)}
          </span>
        </div>
      )}

      {/* Recovery / Profit Estimate */}
      {analysis.recoveryEstimate && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>回本参考预估</div>
          <div style={styles.estimateText}>{formatEstimate(analysis.recoveryEstimate)}</div>
        </div>
      )}
      {analysis.profitEstimate && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>收益参考预估</div>
          <div style={styles.estimateText}>{formatEstimate(analysis.profitEstimate)}</div>
        </div>
      )}

      {/* Position Strategy (profit/base position) */}
      {analysis.positionStrategy && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>分仓操作方案</div>
          <div style={styles.strategyRow}>
            <div style={styles.strategyItem}>
              <span style={styles.strategyLabel}>利润仓 ({analysis.positionStrategy.profitPosition.percent}%)</span>
              <span style={styles.strategyAction}>{analysis.positionStrategy.profitPosition.action}</span>
            </div>
            <div style={styles.strategyItem}>
              <span style={styles.strategyLabel}>底仓 ({analysis.positionStrategy.basePosition.percent}%)</span>
              <span style={styles.strategyAction}>{analysis.positionStrategy.basePosition.action}</span>
            </div>
          </div>
        </div>
      )}

      {/* Batch Plan */}
      {analysis.batchPlan.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>分批方案</div>
          {analysis.batchPlan.map((step, i) => (
            <div key={i} style={styles.batchStep}>
              <span style={styles.batchAction}>
                {step.action === 'buy' ? '买入' : '卖出'} {step.shares}股
              </span>
              <span style={styles.batchPrice}>目标价 {step.targetPrice.toFixed(2)}</span>
              {step.note && <span style={styles.batchNote}>{step.note}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Risk Alerts */}
      {analysis.riskAlerts.length > 0 && (
        <div style={styles.section}>
          {analysis.riskAlerts.map((alert, i) => (
            <div key={i} style={styles.riskTag}>⚠️ {alert}</div>
          ))}
        </div>
      )}

      {/* Technical Indicators */}
      <TechnicalIndicators stockCode={stockCode} />

      <button
        type="button"
        style={styles.triggerButton}
        onClick={handleTrigger}
        disabled={triggering}
      >
        {triggering ? 'AI重新分析中...' : '🔄 重新AI分析'}
      </button>

      <button
        type="button"
        style={styles.deepReportButton}
        onClick={handleDeepReport}
        disabled={generatingDeep}
      >
        {generatingDeep ? '报告生成中...' : '📋 生成深度报告'}
      </button>

      <button
        type="button"
        style={styles.backtestButton}
        onClick={() => setShowBacktest(true)}
      >
        📊 历史回测
      </button>

      {deepReportId !== null && (
        <DeepReportModal
          stockCode={stockCode}
          reportId={deepReportId}
          onClose={() => setDeepReportId(null)}
        />
      )}

      {showBacktest && (
        <BacktestPanel
          stockCode={stockCode}
          onClose={() => setShowBacktest(false)}
        />
      )}

      <div style={styles.disclaimer}>
        以上内容仅供参考，不构成投资依据
      </div>
    </div>
  );
};

function formatEstimate(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.note) return parsed.note;
    if (parsed.text) return parsed.text;
    if (parsed.estimate) return parsed.estimate;
    // Fallback: build readable text from known fields
    if (parsed.estimatedDays) {
      const [min, max] = parsed.estimatedDays;
      return `参考预估：预计${min}-${max}个交易日可能回本（仅供参考，实际走势受多种因素影响）`;
    }
    if (parsed.profitRange) {
      const [min, max] = parsed.profitRange;
      return `参考预估：持有30天预计收益区间${min}%-${max}%（仅供参考，实际走势受多种因素影响）`;
    }
    return raw;
  } catch {
    return raw;
  }
}


const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '14px 0',
    animation: 'slideUp 0.3s ease',
  },
  loading: {
    fontSize: '13px',
    color: '#8b8fa3',
    padding: '20px 0',
    textAlign: 'center' as const,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
    flexWrap: 'wrap' as const,
  },
  stageTag: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#fff',
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    borderRadius: '8px',
    padding: '4px 12px',
    letterSpacing: '0.3px',
  },
  spaceEstimate: {
    fontSize: '13px',
    color: '#555',
  },
  confidenceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
    cursor: 'pointer',
    minHeight: '44px',
    flexWrap: 'wrap' as const,
    padding: '8px 10px',
    background: '#f8f9fc',
    borderRadius: '12px',
    transition: 'all 0.2s ease',
  },
  confidenceBadge: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#fff',
    borderRadius: '14px',
    padding: '4px 12px',
    whiteSpace: 'nowrap' as const,
  },
  confidenceDesc: {
    fontSize: '12px',
    color: '#8b8fa3',
    flex: 1,
  },
  expandArrow: {
    fontSize: '12px',
    color: '#667eea',
  },
  reasoningBox: {
    background: '#f8f9fc',
    borderRadius: '12px',
    padding: '14px',
    marginBottom: '12px',
    border: '1px solid #eef0f5',
  },
  reasoningTitle: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#1a1a2e',
    marginBottom: '8px',
  },
  reasoningText: {
    fontSize: '13px',
    color: '#555',
    lineHeight: '1.7',
    whiteSpace: 'pre-wrap' as const,
  },
  section: {
    marginBottom: '12px',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#1a1a2e',
    marginBottom: '6px',
  },
  signalItem: {
    fontSize: '13px',
    color: '#555',
    lineHeight: '1.6',
  },
  actionTag: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#667eea',
    background: 'rgba(102,126,234,0.1)',
    borderRadius: '8px',
    padding: '4px 12px',
  },
  targetPrice: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#ff4d4f',
  },
  estimateText: {
    fontSize: '13px',
    color: '#555',
    lineHeight: '1.6',
  },
  strategyRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const,
  },
  strategyItem: {
    flex: 1,
    background: '#f8f9fc',
    borderRadius: '12px',
    padding: '10px 12px',
    minWidth: '120px',
    border: '1px solid #eef0f5',
  },
  strategyLabel: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#1a1a2e',
    display: 'block',
    marginBottom: '3px',
  },
  strategyAction: {
    fontSize: '12px',
    color: '#555',
  },
  batchStep: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    fontSize: '13px',
    color: '#555',
    marginBottom: '4px',
    flexWrap: 'wrap' as const,
  },
  batchAction: {
    fontWeight: 600,
    color: '#1a1a2e',
  },
  batchPrice: {
    color: '#ff4d4f',
    fontWeight: 500,
  },
  batchNote: {
    color: '#8b8fa3',
    fontSize: '12px',
  },
  riskTag: {
    fontSize: '12px',
    color: '#d48806',
    background: 'linear-gradient(135deg, #fff7e6, #fff3cd)',
    border: '1px solid rgba(212,136,6,0.15)',
    borderRadius: '8px',
    padding: '6px 10px',
    marginBottom: '4px',
  },
  disclaimer: {
    fontSize: '12px',
    color: '#c0c4cc',
    textAlign: 'center' as const,
    marginTop: '14px',
    borderTop: '1px solid #f0f2f5',
    paddingTop: '10px',
  },
  triggerButton: {
    display: 'block',
    width: '100%',
    padding: '12px 0',
    marginTop: '12px',
    border: 'none',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px',
    boxShadow: '0 4px 12px rgba(102,126,234,0.3)',
    letterSpacing: '0.3px',
  },
  deepReportButton: {
    display: 'block',
    width: '100%',
    padding: '12px 0',
    marginTop: '8px',
    border: '1.5px solid #764ba2',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, rgba(102,126,234,0.08), rgba(118,75,162,0.08))',
    color: '#764ba2',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px',
    letterSpacing: '0.3px',
    transition: 'all 0.2s ease',
  },
  backtestButton: {
    display: 'block',
    width: '100%',
    padding: '12px 0',
    marginTop: '8px',
    border: '1.5px solid #667eea',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, rgba(102,126,234,0.08), rgba(118,75,162,0.08))',
    color: '#667eea',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px',
    letterSpacing: '0.3px',
    transition: 'all 0.2s ease',
  },
};

export default AnalysisPanel;
