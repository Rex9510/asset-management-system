import React, { useState, useEffect, useCallback } from 'react';
import { getMessages, getMessageDetail, MessageResponse } from '../api/messages';

/** Category key for merged filter tabs — matches prototype */
type FilterCategory = 'all' | 'risk' | 'market' | 'tracking' | 'analysis' | 'opportunity';

/** Maps each category to the message types it includes */
const CATEGORY_TYPES: Record<FilterCategory, string[]> = {
  all: [],
  risk: ['volatility_alert', 'stop_loss_alert', 'target_price_alert', 'concentration_risk'],
  market: ['rotation_switch', 'chain_activation', 'market_env_change', 'cycle_bottom', 'event_window'],
  tracking: ['daily_pick_tracking', 'self_correction'],
  analysis: ['scheduled_analysis', 'deep_report'],
  opportunity: ['daily_pick', 'ambush_recommendation'],
};

interface FilterTab {
  label: string;
  value: FilterCategory;
}

const FILTER_TABS: FilterTab[] = [
  { label: '全部', value: 'all' },
  { label: '⚠️ 风险', value: 'risk' },
  { label: '📈 市场', value: 'market' },
  { label: '🔍 追踪', value: 'tracking' },
  { label: '📊 分析', value: 'analysis' },
  { label: '🏹 机会', value: 'opportunity' },
];

const TYPE_LABELS: Record<string, string> = {
  scheduled_analysis: '📊 定时分析',
  volatility_alert: '⚡ 波动提醒',
  self_correction: '🔄 自我修正',
  daily_pick: '📈 每日关注',
  target_price_alert: '🎯 目标价提醒',
  ambush_recommendation: '🏹 埋伏推荐',
  stop_loss_alert: '🛡️ 止损提醒',
  rotation_switch: '🔄 轮动切换',
  chain_activation: '📦 传导链激活',
  event_window: '📅 事件窗口',
  cycle_bottom: '🔄 周期底部',
  market_env_change: '🌤️ 大盘环境变化',
  daily_pick_tracking: '📍 关注追踪',
  concentration_risk: '⚠️ 集中度风险',
  deep_report: '📋 深度报告',
};

const TYPE_BADGE_STYLES: Record<string, React.CSSProperties> = {
  stop_loss_alert: { background: '#fff3e0', color: '#ff9800' },
  volatility_alert: { background: '#fff3e0', color: '#ff9800' },
  target_price_alert: { background: '#fce4ec', color: '#e91e63' },
  concentration_risk: { background: '#fff3e0', color: '#ff9800' },
  rotation_switch: { background: '#e8f0fe', color: '#4a69bd' },
  chain_activation: { background: '#e8f5e9', color: '#2ed573' },
  event_window: { background: '#e8f0fe', color: '#4a69bd' },
  cycle_bottom: { background: '#e8f5e9', color: '#2ed573' },
  market_env_change: { background: '#e8f0fe', color: '#4a69bd' },
  daily_pick_tracking: { background: '#fff3e0', color: '#ff9800' },
  self_correction: { background: '#fce4ec', color: '#e91e63' },
  scheduled_analysis: { background: '#e8f0fe', color: '#4a69bd' },
  deep_report: { background: '#e8f0fe', color: '#4a69bd' },
  daily_pick: { background: '#e8f5e9', color: '#2ed573' },
  ambush_recommendation: { background: '#e3f2fd', color: '#1565c0' },
};

function formatTime(dateStr: string): string {
  const normalized = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}天前`;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Label maps for translating JSON keys to Chinese */
const STAGE_LABELS: Record<string, string> = {
  bottom: '底部', recovery: '复苏', growth: '成长', peak: '顶部', decline: '衰退',
  falling: '下跌阶段', rising: '上涨阶段', high: '高位',
  main_wave: '主升浪', sideways: '震荡', accumulation: '吸筹',
};
const ACTION_LABELS: Record<string, string> = {
  hold: '持有', buy: '买入', sell: '卖出', reduce: '减仓', add: '加仓', watch: '观望',
  strong_buy: '强烈买入', strong_sell: '强烈卖出',
};
const SEVERITY_LABELS: Record<string, string> = {
  moderate: '中等', severe: '严重', low: '轻微',
};
const TRACKING_STATUS_LABELS: Record<string, string> = {
  tracking: '追踪中', expired: '已过期', hit_target: '达到目标', stopped: '已停止',
};

/** 截断过长文本，保留前100字符 */
function truncateText(text: string, maxLen = 100): string {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

/** 安全格式化数字为2位小数 */
function fmt2(val: unknown): string {
  const n = Number(val);
  return isNaN(n) ? String(val) : n.toFixed(2);
}

/** Format detail string — parse JSON for structured message types, render Chinese-friendly text */
function formatDetail(detail: string, type: string): string {
  if (!detail) return '';
  try {
    const d = JSON.parse(detail);
    if (typeof d !== 'object' || d === null) return detail;

    switch (type) {
      case 'deep_report':
        return d.conclusion || detail;

      case 'daily_pick':
        // { stockCode, stockName, period, periodLabel, reason, targetPriceRange:{low,high}, estimatedUpside }
        return [
          d.reason ? truncateText(d.reason) : '',
          d.targetPriceRange ? `目标价区间：${fmt2(d.targetPriceRange.low)}-${fmt2(d.targetPriceRange.high)}元` : '',
          d.estimatedUpside != null ? `预估上升空间：${fmt2(d.estimatedUpside)}%` : '',
          d.periodLabel ? `关注周期：${d.periodLabel}` : '',
        ].filter(Boolean).join('\n');

      case 'chain_activation':
        // { nodeIndex, symbol, name, shortName, change10d, chainStatus }
        return [
          d.name ? `节点：${d.name}` : '',
          d.shortName ? `品种：${d.shortName}` : '',
          d.change10d != null ? `综合涨幅：${fmt2(d.change10d)}%` : '',
        ].filter(Boolean).join('\n');

      case 'concentration_risk':
        // { sectors, riskSector, percentage, totalValue }
        return [
          d.riskSector ? `风险板块：${d.riskSector}` : '',
          d.percentage != null ? `集中度：${fmt2(d.percentage)}%` : '',
          d.totalValue != null ? `持仓总值：${fmt2(d.totalValue)}元` : '',
        ].filter(Boolean).join('\n');

      case 'cycle_bottom':
        // { stockCode, stockName, currentPrice, signals, bottomRange, min3y, max3y, analysisWindowYears? }
        return [
          d.currentPrice != null ? `当前价：${fmt2(d.currentPrice)}元` : '',
          d.bottomRange ? `预估底部区间：${d.bottomRange}` : '',
          Array.isArray(d.signals) && d.signals.length > 0 ? `触发信号：${d.signals.join('、')}` : '',
          d.min3y != null && d.max3y != null
            ? typeof d.analysisWindowYears === 'number' && d.analysisWindowYears > 0
              ? `参考约${d.analysisWindowYears % 1 === 0 ? d.analysisWindowYears : d.analysisWindowYears.toFixed(1)}年价格区间：${fmt2(d.min3y)}-${fmt2(d.max3y)}`
              : `参考价格区间：${fmt2(d.min3y)}-${fmt2(d.max3y)}`
            : '',
        ].filter(Boolean).join('\n');

      case 'volatility_alert':
        // { changePercent, [volatilityReport], stage, confidence, actionRef, reasoning }
        return [
          d.changePercent != null ? `涨跌幅：${Number(d.changePercent) > 0 ? '+' : ''}${fmt2(d.changePercent)}%` : '',
          d.stage ? `周期阶段：${STAGE_LABELS[d.stage] || d.stage}` : '',
          d.actionRef ? `参考操作：${ACTION_LABELS[d.actionRef] || d.actionRef}` : '',
          d.confidence != null ? `置信度：${fmt2(d.confidence)}%` : '',
          d.reasoning ? truncateText(d.reasoning) : '',
        ].filter(Boolean).join('\n');

      case 'scheduled_analysis':
        // { stage, confidence, actionRef, reasoning }
        return [
          d.stage ? `周期阶段：${STAGE_LABELS[d.stage] || d.stage}` : '',
          d.actionRef ? `参考操作：${ACTION_LABELS[d.actionRef] || d.actionRef}` : '',
          d.confidence != null ? `置信度：${fmt2(d.confidence)}%` : '',
          d.reasoning ? truncateText(d.reasoning) : '',
        ].filter(Boolean).join('\n');

      case 'rotation_switch':
        // { previousPhase, previousLabel, currentPhase, currentLabel, etfPerformance }
        return [
          d.previousLabel && d.currentLabel ? `轮动切换：${d.previousLabel} → ${d.currentLabel}` : '',
        ].filter(Boolean).join('\n');

      case 'market_env_change':
        // { previousEnvironment, previousLabel, currentEnvironment, currentLabel, indicators }
        return [
          d.previousLabel && d.currentLabel ? `环境变化：${d.previousLabel} → ${d.currentLabel}` : '',
        ].filter(Boolean).join('\n');

      case 'stop_loss_alert':
        // { positionId, stockCode, stockName, stopLossPrice, currentPrice, triggerTime }
        return [
          d.currentPrice != null ? `当前价：${fmt2(d.currentPrice)}元` : '',
          d.stopLossPrice != null ? `止损价：${fmt2(d.stopLossPrice)}元` : '',
          d.currentPrice != null && d.stopLossPrice != null
            ? `已跌破止损线${((1 - d.currentPrice / d.stopLossPrice) * 100).toFixed(2)}%`
            : '',
        ].filter(Boolean).join('\n');

      case 'target_price_alert':
        // { stockCode, stockName, currentPrice, targetPrice, alertType, message }
        return [
          d.currentPrice != null ? `当前价：${fmt2(d.currentPrice)}元` : '',
          d.targetPrice != null ? `目标价：${fmt2(d.targetPrice)}元` : '',
          d.message ? truncateText(d.message) : '',
        ].filter(Boolean).join('\n');

      case 'ambush_recommendation':
        // { stockCode, stockName, lowPositionReason, reboundPotential, buyPriceRange:{low,high}, holdingPeriodRef }
        return [
          d.lowPositionReason ? truncateText(d.lowPositionReason) : '',
          d.reboundPotential ? `预估反弹空间：${d.reboundPotential}` : '',
          d.buyPriceRange ? `参考买入区间：${fmt2(d.buyPriceRange.low)}-${fmt2(d.buyPriceRange.high)}元` : '',
          d.holdingPeriodRef ? `持仓周期参考：${d.holdingPeriodRef}` : '',
        ].filter(Boolean).join('\n');

      case 'daily_pick_tracking':
        // { pickMessageId, stockCode, stockName, pickDate, pickPrice, trackingDays, trackedPrice, returnPercent, status }
        return [
          d.pickPrice != null && d.trackedPrice != null
            ? `关注价：${fmt2(d.pickPrice)} → 当前价：${fmt2(d.trackedPrice)}`
            : '',
          d.returnPercent != null ? `收益率：${Number(d.returnPercent) >= 0 ? '+' : ''}${fmt2(d.returnPercent)}%` : '',
          d.trackingDays != null ? `追踪天数：${d.trackingDays}天` : '',
          d.status ? `状态：${TRACKING_STATUS_LABELS[d.status] || d.status}` : '',
        ].filter(Boolean).join('\n');

      case 'self_correction':
        // { originalAnalysisId, deviationReason, severity, predictedStage, predictedAction, actualChangePercent, correctedStage, correctedAction, correctedReasoning }
        return [
          d.deviationReason ? truncateText(d.deviationReason) : '',
          d.severity ? `偏差程度：${SEVERITY_LABELS[d.severity] || d.severity}` : '',
          d.actualChangePercent != null ? `实际涨跌幅：${fmt2(d.actualChangePercent)}%` : '',
          d.correctedStage ? `修正阶段：${STAGE_LABELS[d.correctedStage] || d.correctedStage}` : '',
          d.correctedAction ? `修正操作：${ACTION_LABELS[d.correctedAction] || d.correctedAction}` : '',
          d.correctedReasoning ? truncateText(d.correctedReasoning) : '',
        ].filter(Boolean).join('\n');

      case 'event_window':
        // { eventId, eventName, eventDate, eventEndDate, category, relatedSectors, windowStatus, windowLabel, tip }
        return [
          d.eventName || '',
          d.windowLabel || '',
          d.tip ? truncateText(d.tip) : '',
          Array.isArray(d.relatedSectors) && d.relatedSectors.length > 0 ? `相关板块：${d.relatedSectors.join('、')}` : '',
        ].filter(Boolean).join('\n');

      default: {
        // Generic fallback: extract readable string values
        if (d.reasoning) return truncateText(d.reasoning);
        if (d.conclusion) return truncateText(d.conclusion);
        if (d.summary) return truncateText(d.summary);
        if (d.message) return truncateText(d.message);
        if (d.detail && typeof d.detail === 'string') return truncateText(d.detail);
        const textParts = Object.values(d).filter(v => typeof v === 'string' && v.length > 2);
        return (textParts as string[]).map(t => truncateText(t)).join('\n') || detail;
      }
    }
  } catch {
    return detail;
  }
}

const MessageCenterPage: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('all');
  const [messages, setMessages] = useState<MessageResponse[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async (category: FilterCategory, pageNum: number, append: boolean) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const types = CATEGORY_TYPES[category];
      const typeParam = types.length > 0 ? types.join(',') : undefined;
      const result = await getMessages({ type: typeParam, page: pageNum, limit: 20 });
      if (append) {
        setMessages(prev => [...prev, ...result.messages]);
      } else {
        setMessages(result.messages);
      }
      setHasMore(result.hasMore);
      setPage(pageNum);
    } catch {
      setError('加载失败，请稍后重试');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    setExpandedId(null);
    setExpandedDetail(null);
    fetchMessages(activeCategory, 1, false);
  }, [activeCategory, fetchMessages]);

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchMessages(activeCategory, page + 1, true);
    }
  };

  const handleToggleExpand = async (msg: MessageResponse) => {
    if (expandedId === msg.id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(msg.id);
    setExpandedDetail(null);
    setLoadingDetail(true);
    try {
      const detail = await getMessageDetail(msg.id);
      setExpandedDetail(formatDetail(detail.detail, detail.type));
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isRead: true } : m));
    } catch {
      setExpandedDetail('加载详情失败');
    } finally {
      setLoadingDetail(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Sticky header — matches prototype */}
      <div style={styles.stickyHeader}>
        <div style={styles.headerBar}>消息中心</div>
        <div style={styles.filterBar} role="tablist" aria-label="消息类型筛选">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={activeCategory === tab.value}
              style={{
                ...styles.filterChip,
                ...(activeCategory === tab.value ? styles.filterChipActive : {}),
              }}
              onClick={() => setActiveCategory(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Message List */}
      <div style={styles.listSection}>
        {loading ? (
          <div style={styles.emptyState}>加载中...</div>
        ) : error ? (
          <div style={styles.errorState}>{error}</div>
        ) : messages.length === 0 ? (
          <div style={styles.emptyState}>暂无消息</div>
        ) : (
          <>
            {messages.map(msg => {
              const badgeStyle = TYPE_BADGE_STYLES[msg.type] || { background: '#e8f0fe', color: '#4a69bd' };
              return (
                <div
                  key={msg.id}
                  style={styles.messageCard}
                  onClick={() => handleToggleExpand(msg)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleToggleExpand(msg); }}
                  aria-expanded={expandedId === msg.id}
                >
                  <div style={{ ...styles.typeBadge, ...badgeStyle }}>
                    {TYPE_LABELS[msg.type] || msg.type}
                  </div>
                  <div style={styles.messageTitle}>
                    {msg.summary}
                    {!msg.isRead && <span style={styles.unreadDot} data-testid="unread-dot" />}
                  </div>
                  {msg.stockName && (
                    <div style={styles.messageSummary}>
                      {msg.stockName}({msg.stockCode})
                    </div>
                  )}
                  <div style={styles.messageTime}>{formatTime(msg.createdAt)}</div>

                  {expandedId === msg.id && (
                    <div style={styles.detailSection} data-testid="message-detail">
                      {loadingDetail ? (
                        <div style={styles.detailLoading}>加载详情中...</div>
                      ) : (
                        <div style={styles.detailContent}>{expandedDetail || '暂无详情'}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {hasMore && (
              <button
                type="button"
                style={styles.loadMoreButton}
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? '加载中...' : '加载更多'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#f5f6fa',
    minHeight: '100%',
    paddingBottom: '80px',
  },
  stickyHeader: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  headerBar: {
    background: '#1a1a2e',
    color: '#fff',
    padding: '12px 16px',
    textAlign: 'center' as const,
    fontSize: '17px',
    fontWeight: 600,
  },
  filterBar: {
    display: 'flex',
    gap: '6px',
    padding: '10px 12px',
    background: '#f5f6fa',
    borderBottom: '1px solid #eee',
  },
  filterChip: {
    flex: 1,
    padding: '5px 4px',
    borderRadius: '14px',
    fontSize: '12px',
    border: '1px solid #ddd',
    background: '#fff',
    whiteSpace: 'nowrap' as const,
    cursor: 'pointer',
    minHeight: '44px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  },
  filterChipActive: {
    background: '#4a69bd',
    color: '#fff',
    border: '1px solid #4a69bd',
  },
  listSection: {
    padding: '12px 16px 0',
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '40px 0',
    color: '#999',
    fontSize: '14px',
  },
  errorState: {
    textAlign: 'center' as const,
    padding: '40px 0',
    color: '#ff4757',
    fontSize: '14px',
  },
  messageCard: {
    background: '#fff',
    borderRadius: '10px',
    padding: '14px',
    marginBottom: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
    borderLeft: '3px solid #4a69bd',
    cursor: 'pointer',
  },
  typeBadge: {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '8px',
    display: 'inline-block',
    marginBottom: '6px',
    fontWeight: 500,
  },
  messageTitle: {
    fontSize: '15px',
    fontWeight: 600,
    marginBottom: '4px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  unreadDot: {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#ff4757',
    flexShrink: 0,
  },
  messageSummary: {
    fontSize: '13px',
    color: '#666',
    lineHeight: '1.5',
  },
  messageTime: {
    fontSize: '11px',
    color: '#bbb',
    marginTop: '6px',
  },
  detailSection: {
    marginTop: '10px',
    paddingTop: '10px',
    borderTop: '1px solid #f0f0f0',
  },
  detailLoading: {
    color: '#999',
    fontSize: '13px',
  },
  detailContent: {
    fontSize: '13px',
    color: '#333',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  loadMoreButton: {
    width: '100%',
    padding: '14px',
    border: 'none',
    background: '#fff',
    borderRadius: '10px',
    fontSize: '14px',
    color: '#4a69bd',
    cursor: 'pointer',
    minHeight: '44px',
    marginBottom: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
    fontWeight: 600,
  },
};

export default MessageCenterPage;
