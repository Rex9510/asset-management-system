import React, { useEffect, useState, useCallback } from 'react';
import { getCycleMonitors, addCycleMonitor, deleteCycleMonitor, CycleMonitorData } from '../api/cycle';

const statusConfig: Record<string, { color: string; bg: string; label: string; emoji: string }> = {
  bottom: { color: '#2ed573', bg: 'rgba(46,213,115,0.1)', label: '底部区间', emoji: '🟢' },
  falling: { color: '#ffa502', bg: 'rgba(255,165,2,0.1)', label: '下跌中段', emoji: '🟡' },
  rising: { color: '#2ed573', bg: 'rgba(46,213,115,0.1)', label: '上涨阶段', emoji: '🟢' },
  high: { color: '#ff4757', bg: 'rgba(255,71,87,0.1)', label: '高位运行', emoji: '🔴' },
};

const CycleMonitor: React.FC = () => {
  const [monitors, setMonitors] = useState<CycleMonitorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [stockInput, setStockInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [showInput, setShowInput] = useState(false);

  const fetchMonitors = useCallback(() => {
    setLoading(true);
    setError(false);
    getCycleMonitors()
      .then((data) => { setMonitors(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  useEffect(() => { fetchMonitors(); }, [fetchMonitors]);

  const handleAdd = async () => {
    const code = stockInput.trim();
    if (!code || adding) return;
    setAdding(true);
    try {
      await addCycleMonitor(code);
      setStockInput('');
      setShowInput(false);
      fetchMonitors();
    } catch { /* interceptor */ }
    finally { setAdding(false); }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteCycleMonitor(id);
      setMonitors((prev) => prev.filter((m) => m.id !== id));
    } catch { /* interceptor */ }
  };

  if (error) return null;

  return (
    <div style={st.card} data-testid="cycle-monitor-card">
      <div style={st.header}>
        <span style={st.title}>🔄 周期监控</span>
        <span
          style={st.addLink}
          role="button"
          tabIndex={0}
          onClick={() => setShowInput(!showInput)}
          onKeyDown={(e) => { if (e.key === 'Enter') setShowInput(!showInput); }}
          data-testid="cycle-add-toggle"
        >
          + 添加
        </span>
      </div>

      {showInput && (
        <div style={st.inputRow} data-testid="cycle-input-row">
          <input
            type="text"
            value={stockInput}
            onChange={(e) => setStockInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="输入股票代码或名称"
            style={st.input}
            data-testid="cycle-stock-input"
            autoFocus
          />
          <button
            type="button"
            style={{ ...st.submitBtn, opacity: adding || !stockInput.trim() ? 0.5 : 1 }}
            onClick={handleAdd}
            disabled={adding || !stockInput.trim()}
            data-testid="cycle-submit-btn"
          >
            {adding ? '...' : '添加'}
          </button>
        </div>
      )}

      {loading ? (
        <div style={st.skeleton} data-testid="cycle-loading">
          <div style={st.skeletonBar} />
          <div style={{ ...st.skeletonBar, width: '80%', marginTop: '8px' }} />
        </div>
      ) : monitors.length === 0 ? (
        <div style={st.empty} data-testid="cycle-empty">
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>📊</div>
          <div style={{ fontSize: '14px', color: '#999' }}>暂无周期监控</div>
          <div style={{ fontSize: '12px', color: '#bbb', marginTop: '4px' }}>点击右上角 + 添加监控标的</div>
        </div>
      ) : (
        <div data-testid="cycle-list">
          {monitors.map((m, idx) => (
            <MonitorItem key={m.id} monitor={m} onDelete={handleDelete} isLast={idx === monitors.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
};

const MonitorItem: React.FC<{
  monitor: CycleMonitorData;
  onDelete: (id: number) => void;
  isLast: boolean;
}> = ({ monitor, onDelete, isLast }) => {
  const cfg = statusConfig[monitor.status] || statusConfig.falling;

  return (
    <div
      style={{ ...st.item, borderBottom: isLast ? 'none' : '1px solid #f0f0f0' }}
      data-testid={`cycle-item-${monitor.id}`}
    >
      <div style={st.itemHeader}>
        <div>
          <span style={st.stockName}>{monitor.stockName}</span>
          <span style={st.stockCode}>{monitor.stockCode}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{ ...st.statusBadge, background: cfg.bg, color: cfg.color }}
            data-testid={`cycle-status-${monitor.id}`}
            data-status={monitor.status}
          >
            {cfg.emoji} {cfg.label}
          </span>
          <button
            type="button"
            style={st.deleteBtn}
            onClick={() => onDelete(monitor.id)}
            aria-label={`删除${monitor.stockName}监控`}
            data-testid={`cycle-delete-${monitor.id}`}
          >
            🗑
          </button>
        </div>
      </div>
      {monitor.cycleLength && (
        <div style={st.cycleDesc}>⏱ 周期节奏：{monitor.cycleLength}一轮</div>
      )}
      {monitor.description && (
        <div style={{ ...st.posDesc, color: cfg.color }} data-testid={`cycle-desc-${monitor.id}`}>
          📍 {monitor.description}
        </div>
      )}
      {/* 周期进度条 */}
      <CycleProgressBar
        status={monitor.status}
        currentMonths={monitor.currentMonths}
        cycleLengthMonths={monitor.cycleLengthMonths}
      />
    </div>
  );
};

// 进度条三段：涨(0-33%) 跌(33-66%) 横(66-100%)
// status 决定圆点在哪个段，currentMonths 决定段内偏移
const phaseRanges: Record<string, [number, number]> = {
  rising: [0, 33],    // 涨段
  high:   [0, 33],    // 高位也在涨段（接近末尾）
  falling:[33, 66],   // 跌段
  bottom: [66, 100],  // 横盘段
};
// 无数据时的默认位置
const phaseDefaults: Record<string, number> = {
  rising: 17, high: 28, falling: 50, bottom: 83,
};

const CycleProgressBar: React.FC<{
  status: string;
  currentMonths: number | null;
  cycleLengthMonths: number | null;
}> = ({ status, currentMonths, cycleLengthMonths }) => {
  let pos = phaseDefaults[status] ?? 50;
  const range = phaseRanges[status];
  if (range && cycleLengthMonths && cycleLengthMonths > 0 && currentMonths !== null && currentMonths >= 0) {
    // 每个阶段大约占周期的1/3
    const phaseMonths = cycleLengthMonths / 3;
    const ratio = Math.min(currentMonths / phaseMonths, 1);
    // high 状态从涨段末尾开始（反向：越久越接近顶部33%）
    const [start, end] = range;
    if (status === 'high') {
      // high 从涨段中间开始往末尾走
      pos = start + (end - start) * (0.5 + ratio * 0.5);
    } else {
      pos = start + (end - start) * ratio;
    }
    pos = Math.min(Math.max(pos, 2), 98);
  }
  const dotColor = statusConfig[status]?.color || '#ffa502';

  // 月份标签
  const monthLabel = currentMonths !== null && currentMonths > 0
    ? `第${currentMonths}月`
    : null;
  // 剩余月数（当前阶段内的剩余，每阶段约占周期1/3）
  let remainLabel: string | null = null;
  if (cycleLengthMonths && cycleLengthMonths > 0 && currentMonths !== null) {
    const phaseMonths = Math.round(cycleLengthMonths / 3);
    const remain = phaseMonths - currentMonths;
    if (remain <= 0) {
      remainLabel = '阶段末';
    } else if (remain >= 24) {
      remainLabel = `本阶段余${(remain / 12).toFixed(1).replace(/\.0$/, '')}年`;
    } else {
      remainLabel = `本阶段余${remain}月`;
    }
  }

  return (
    <div style={{ marginTop: '3px' }}>
      <div style={st.progressTrack}>
        <div style={{
          position: 'absolute' as const, left: 0, top: 0, height: '100%', width: '100%',
          background: 'linear-gradient(to right, #2ed573 33%, #ff4757 33% 66%, #ffa502 66%)',
          borderRadius: '2px', opacity: 0.3,
        }} />
        <div style={{
          position: 'absolute' as const, top: '-3px', left: `${pos}%`,
          width: '10px', height: '10px', borderRadius: '50%',
          background: dotColor, border: '2px solid #fff',
          boxShadow: '0 0 4px rgba(0,0,0,0.2)', transform: 'translateX(-50%)',
        }} />
        {/* monthLabel moved to progressLabels row below */}
      </div>
      <div style={st.progressLabels}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {status === 'rising' || status === 'high' ? '▲ 涨' : '涨'}
          {(status === 'rising' || status === 'high') && monthLabel && <span data-testid="cycle-month-label" style={{ color: dotColor, fontSize: '9px', fontWeight: 600 }}>{monthLabel}</span>}
          {(status === 'rising' || status === 'high') && remainLabel && <span style={{ color: '#999', fontSize: '9px' }}>({remainLabel})</span>}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {status === 'falling' ? '▲ 跌' : '跌'}
          {status === 'falling' && monthLabel && <span data-testid="cycle-month-label" style={{ color: dotColor, fontSize: '9px', fontWeight: 600 }}>{monthLabel}</span>}
          {status === 'falling' && remainLabel && <span style={{ color: '#999', fontSize: '9px' }}>({remainLabel})</span>}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {status === 'bottom' ? '▲ 横' : '横'}
          {status === 'bottom' && monthLabel && <span data-testid="cycle-month-label" style={{ color: dotColor, fontSize: '9px', fontWeight: 600 }}>{monthLabel}</span>}
          {status === 'bottom' && remainLabel && <span style={{ color: '#999', fontSize: '9px' }}>({remainLabel})</span>}
        </span>
      </div>
    </div>
  );
};

const st: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: '12px',
    padding: '12px',
    marginBottom: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0',
  },
  title: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#333',
  },
  addLink: {
    fontSize: '12px',
    color: '#4a69bd',
    cursor: 'pointer',
    padding: '6px 8px',
  },
  inputRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '8px',
    marginTop: '6px',
  },
  input: {
    flex: 1,
    height: '36px',
    padding: '0 12px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#333',
    outline: 'none',
  },
  submitBtn: {
    height: '36px',
    padding: '0 16px',
    border: 'none',
    background: '#4a69bd',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    borderRadius: '8px',
    cursor: 'pointer',
  },
  skeleton: {
    padding: '4px 0',
  },
  skeletonBar: {
    height: '14px',
    borderRadius: '8px',
    background: 'linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)',
    backgroundSize: '200% 100%',
  },
  empty: {
    textAlign: 'center' as const,
    padding: '16px 0 12px',
  },
  item: {
    padding: '6px 0',
  },
  itemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '2px',
  },
  stockName: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#333',
  },
  stockCode: {
    fontSize: '11px',
    color: '#999',
    marginLeft: '4px',
  },
  statusBadge: {
    fontSize: '10px',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: '8px',
    whiteSpace: 'nowrap' as const,
  },
  deleteBtn: {
    border: 'none',
    background: 'transparent',
    fontSize: '14px',
    cursor: 'pointer',
    padding: '4px 6px',
  },
  cycleDesc: {
    fontSize: '11px',
    color: '#999',
  },
  posDesc: {
    fontSize: '11px',
    marginTop: '2px',
    lineHeight: '15px',
  },
  progressTrack: {
    position: 'relative' as const,
    height: '4px',
    background: '#f0f0f0',
    borderRadius: '2px',
  },
  progressLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '9px',
    color: '#bbb',
    marginTop: '2px',
  },
};

export default CycleMonitor;
