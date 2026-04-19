import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { getChartData, ProfitCurveMeta, ProfitCurvePoint } from '../api/snapshot';
import { getPositions, Position } from '../api/positions';
import { useMarketSSE } from '../hooks/useMarketSSE';

/** 日历跨月切换：拉取近一年快照（含相邻月用于首日涨跌） */
const CALENDAR_FETCH_PERIOD = '365d';

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'] as const;

const ProfitChart: React.FC = () => {
  const [data, setData] = useState<ProfitCurvePoint[]>([]);
  const [profitCurveMeta, setProfitCurveMeta] = useState<ProfitCurveMeta | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const holdings = useMemo(() => positions.filter((p) => p.positionType === 'holding'), [positions]);
  const stockCodes = useMemo(() => holdings.map((p) => p.stockCode), [holdings]);
  const { quotes, refreshQuotes } = useMarketSSE(stockCodes);

  const liveSummary = useMemo(() => {
    if (!holdings.length) return null;
    let totalValue = 0;
    let totalCost = 0;
    for (const p of holdings) {
      const quote = quotes.get(p.stockCode);
      const price = quote?.price ?? p.currentPrice ?? 0;
      const shares = p.shares ?? 0;
      totalValue += price * shares;
      totalCost += (p.costPrice ?? 0) * shares;
    }
    const returnOnCostPct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
    return { totalValue, totalCost, returnOnCostPct };
  }, [holdings, quotes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(false);
    Promise.all([
      getChartData(CALENDAR_FETCH_PERIOD),
      getPositions('holding').catch(() => []),
    ])
      .then(([chart, pos]) => {
        setData(chart.profitCurve);
        setProfitCurveMeta(chart.profitCurveMeta ?? null);
        setPositions(pos);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!visible || stockCodes.length === 0) return;
    void refreshQuotes(stockCodes);
  }, [visible, stockCodes, refreshQuotes]);

  useEffect(() => {
    if (visible) fetchData();
  }, [visible, fetchData]);

  useEffect(() => {
    const onTab = (e: Event) => {
      const tab = (e as CustomEvent<{ tab: string }>).detail?.tab;
      if (tab !== 'profile' || !visible) return;
      fetchData();
    };
    window.addEventListener('tab-switch-refresh', onTab);
    return () => window.removeEventListener('tab-switch-refresh', onTab);
  }, [visible, fetchData]);

  return (
    <div ref={containerRef} style={styles.card} data-testid="profit-chart-card">
      <div style={styles.header}>
        <span style={styles.title}>📅 持仓收益日历</span>
        <span style={styles.rangeHint}>近一年快照</span>
      </div>
      {!visible ? null : loading ? (
        <div style={styles.skeleton} data-testid="profit-loading">
          <div style={styles.skeletonBar} />
        </div>
      ) : error ? (
        <div style={styles.empty} data-testid="profit-error">
          加载失败
        </div>
      ) : data.length === 0 ? (
        <div style={styles.empty} data-testid="profit-empty">
          <div style={styles.emptyIcon}>📊</div>
          <div>暂无收益率数据</div>
          <div style={styles.emptyHint}>收盘后记录快照；有数据后可按月查看涨跌</div>
        </div>
      ) : (
        <CalendarArea points={data} liveSummary={liveSummary} profitCurveMeta={profitCurveMeta} />
      )}
    </div>
  );
};

/** A 股习惯：盈红 #ff4d4f，亏绿 #52c41a；亏损带负号 */
function pnlTextAndColor(n: number): { text: string; color: string } {
  const abs = Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n < 0) return { text: `-¥${abs}`, color: '#52c41a' };
  if (n > 0) return { text: `+¥${abs}`, color: '#ff4d4f' };
  return { text: '¥0.00', color: '#8b8fa3' };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatISODateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 周一=0 … 周日=6 */
function mondayWeekIndex(d: Date): number {
  const w = d.getDay();
  return w === 0 ? 6 : w - 1;
}

/** 周一=一 … 周日=日 */
function weekdayZh(isoDate: string): string {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((x) => Number.isNaN(x))) return '';
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()] ?? '';
}

type MonthCell = { iso: string; day: number; inMonth: boolean };

function buildMonthGrid(year: number, month1to12: number): MonthCell[] {
  const cells: MonthCell[] = [];
  const pad = mondayWeekIndex(new Date(year, month1to12 - 1, 1));
  for (let i = 0; i < pad; i++) {
    const t = new Date(year, month1to12 - 1, 1 - (pad - i));
    cells.push({ iso: formatISODateLocal(t), day: t.getDate(), inMonth: false });
  }
  const dim = new Date(year, month1to12, 0).getDate();
  for (let d = 1; d <= dim; d++) {
    cells.push({
      iso: formatISODateLocal(new Date(year, month1to12 - 1, d)),
      day: d,
      inMonth: true,
    });
  }
  let trail = 1;
  while (cells.length % 7 !== 0) {
    const t = new Date(year, month1to12, trail);
    cells.push({ iso: formatISODateLocal(t), day: t.getDate(), inMonth: false });
    trail++;
  }
  return cells;
}

function goPrevMonth(y: number, m: number): { y: number; m: number } {
  if (m <= 1) return { y: y - 1, m: 12 };
  return { y, m: m - 1 };
}

function goNextMonth(y: number, m: number): { y: number; m: number } {
  if (m >= 12) return { y: y + 1, m: 1 };
  return { y, m: m + 1 };
}

/**
 * 本月浮动盈亏变化：优先「当月末累计浮盈 − 上月末参考快照累计浮盈」；
 * 若近一年窗口内没有上月参考（anchor），则退回「当月各快照日 dayProfitDelta 之和」（含首条对上日的跨月波动）。
 */
function monthFloatingPnlChange(points: ProfitCurvePoint[], viewYear: number, viewMonth: number): number | null {
  const monthStart = `${viewYear}-${pad2(viewMonth)}-01`;
  let anchor: ProfitCurvePoint | undefined;
  for (const p of points) {
    if (p.date < monthStart) anchor = p;
  }
  const inMonth: ProfitCurvePoint[] = [];
  for (const p of points) {
    const [y, m] = p.date.split('-').map(Number);
    if (y === viewYear && m === viewMonth) inMonth.push(p);
  }
  if (!inMonth.length) return null;
  const lastIn = inMonth[inMonth.length - 1];
  if (anchor) {
    return Math.round((lastIn.totalProfit - anchor.totalProfit) * 100) / 100;
  }
  let sumDelta = 0;
  let deltaCount = 0;
  for (const p of inMonth) {
    if (p.dayProfitDelta != null) {
      sumDelta += p.dayProfitDelta;
      deltaCount++;
    }
  }
  if (deltaCount > 0) {
    return Math.round(sumDelta * 100) / 100;
  }
  return Math.round((lastIn.totalProfit - inMonth[0].totalProfit) * 100) / 100;
}

/** 日历格内涨跌（元）：无 ¥、无千分位逗号，两位小数；窄格内由样式允许换行 */
function formatDayCellDeltaYuan(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  const body = Math.abs(n).toFixed(2);
  return `${sign}${body}`;
}

function cellVisual(
  point: ProfitCurvePoint | undefined,
  selected: boolean
): { bg: string; border: string; color: string } {
  if (!point) {
    return {
      bg: 'rgba(246,247,251,0.95)',
      border: selected ? '2px solid #667eea' : '1px solid rgba(0,0,0,0.06)',
      color: '#b0b4c8',
    };
  }
  const dPl = point.dayProfitDelta;
  if (dPl == null) {
    return {
      bg: 'rgba(139,143,163,0.12)',
      border: selected ? '2px solid #667eea' : '1px solid rgba(139,143,163,0.25)',
      color: '#5c5f72',
    };
  }
  const mag = Math.abs(dPl);
  const strong = mag >= 500;
  if (dPl >= 0) {
    return {
      bg: strong ? 'rgba(255,77,79,0.22)' : 'rgba(255,77,79,0.1)',
      border: selected ? '2px solid #667eea' : '1px solid rgba(255,77,79,0.35)',
      color: '#cf1322',
    };
  }
  return {
    bg: strong ? 'rgba(82,196,26,0.2)' : 'rgba(82,196,26,0.1)',
    border: selected ? '2px solid #667eea' : '1px solid rgba(82,196,26,0.35)',
    color: '#237804',
  };
}

type LivePortfolioSummary = { totalValue: number; totalCost: number; returnOnCostPct: number };

const CalendarArea: React.FC<{
  points: ProfitCurvePoint[];
  liveSummary: LivePortfolioSummary | null;
  profitCurveMeta: ProfitCurveMeta | null;
}> = ({ points, liveSummary, profitCurveMeta }) => {
  const byDate = useMemo(() => {
    const m = new Map<string, ProfitCurvePoint>();
    for (const p of points) m.set(p.date, p);
    return m;
  }, [points]);

  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const initMonthRef = useRef(false);

  useEffect(() => {
    if (!initMonthRef.current && points.length) {
      initMonthRef.current = true;
      const last = points[points.length - 1].date;
      const [y, mo] = last.split('-').map(Number);
      if (y && mo) {
        setViewYear(y);
        setViewMonth(mo);
      }
    }
  }, [points]);

  useEffect(() => {
    const inM = points.filter((p) => {
      const [y, m] = p.date.split('-').map(Number);
      return y === viewYear && m === viewMonth;
    });
    if (!inM.length) {
      setSelectedIso(null);
      return;
    }
    setSelectedIso((cur) => {
      if (cur && inM.some((p) => p.date === cur)) return cur;
      return inM[inM.length - 1].date;
    });
  }, [viewYear, viewMonth, points]);

  const returnSeries = points.map((p) =>
    typeof p.returnOnCostPct === 'number' && !Number.isNaN(p.returnOnCostPct)
      ? p.returnOnCostPct
      : p.totalCost > 0
        ? (p.totalProfit / p.totalCost) * 100
        : 0
  );
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const lastRetSnapshot = returnSeries[returnSeries.length - 1] ?? 0;
  const firstRet = returnSeries[0] ?? 0;
  const intervalChangePct = lastPoint && firstPoint ? lastRetSnapshot - firstRet : 0;
  const isPositiveInterval = intervalChangePct >= 0;

  const displayReturnPct = liveSummary ? liveSummary.returnOnCostPct : lastRetSnapshot;
  const displayMarketValue = liveSummary ? liveSummary.totalValue : (lastPoint?.totalValue ?? 0);

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const selectedPoint = selectedIso ? byDate.get(selectedIso) : undefined;

  const monthCumulativePnl = useMemo(
    () => monthFloatingPnlChange(points, viewYear, viewMonth),
    [points, viewYear, viewMonth]
  );

  const onPrev = () => {
    const { y, m } = goPrevMonth(viewYear, viewMonth);
    setViewYear(y);
    setViewMonth(m);
  };
  const today = new Date();
  const maxYear = today.getFullYear();
  const maxMonth = today.getMonth() + 1;
  const atLatestMonth = viewYear === maxYear && viewMonth === maxMonth;

  const onNext = () => {
    if (atLatestMonth) return;
    const { y, m } = goNextMonth(viewYear, viewMonth);
    setViewYear(y);
    setViewMonth(m);
  };

  const ap = selectedPoint;
  const dMv = ap?.dayMvChangePct;
  const dPl = ap?.dayProfitDelta;
  const hasDayCompare = dMv != null && dPl != null;
  const dMvStr = hasDayCompare ? `${dMv >= 0 ? '+' : ''}${dMv.toFixed(2)}%` : '—';
  const dMvColor = !hasDayCompare ? '#8b8fa3' : dMv >= 0 ? '#ff4d4f' : '#52c41a';
  const dPlPnl = hasDayCompare && dPl != null ? pnlTextAndColor(dPl) : null;
  const cumPnl = ap ? pnlTextAndColor(ap.totalProfit) : null;

  const monthPnlDisplay = monthCumulativePnl != null ? pnlTextAndColor(monthCumulativePnl) : null;

  return (
    <div data-testid="profit-calendar">
      <div style={styles.summaryGrid}>
        <div style={styles.kpi}>
          <div style={styles.kpiLabel} title={liveSummary ? '按当前行情与持仓计算' : '来自最近一条收盘快照'}>
            收益率
          </div>
          <div
            style={{
              ...styles.kpiValue,
              color: !lastPoint && !liveSummary ? '#1a1a2e' : displayReturnPct >= 0 ? '#ff4d4f' : '#52c41a',
            }}
            data-testid="current-return-pct"
          >
            {lastPoint || liveSummary ? `${displayReturnPct >= 0 ? '+' : ''}${displayReturnPct.toFixed(2)}%` : '—'}
          </div>
        </div>
        <div style={styles.kpi}>
          <div style={styles.kpiLabel} title={liveSummary ? '当前持仓 × 最新价（与快照无关）' : '最近一条快照总市值'}>
            市值
          </div>
          <div style={styles.kpiValueMuted} data-testid="latest-market-value">
            {lastPoint || liveSummary
              ? `¥${displayMarketValue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : '—'}
          </div>
        </div>
        <div style={styles.kpi}>
          <div style={styles.kpiLabel} title="近一年：相对成本收益率，序列首尾之差（百分点）">
            近一年
          </div>
          <div
            style={{
              ...styles.kpiValueSm,
              color: isPositiveInterval ? '#ff4d4f' : '#52c41a',
            }}
            data-testid="interval-change-pct"
          >
            {isPositiveInterval ? '+' : ''}
            {intervalChangePct.toFixed(2)}点
          </div>
        </div>
        <div style={styles.kpi}>
          <div
            style={styles.kpiLabel}
            title="优先：当月末快照累计浮盈 − 上月末参考；若无上月数据则按当月各日浮动盈亏增减合计"
          >
            本月累计
          </div>
          {monthPnlDisplay ? (
            <div style={{ ...styles.kpiValueSm, color: monthPnlDisplay.color }} data-testid="month-cumulative-pnl">
              {monthPnlDisplay.text}
            </div>
          ) : (
            <div style={styles.kpiValueMuted} data-testid="month-cumulative-pnl">
              —
            </div>
          )}
        </div>
      </div>

      <div style={styles.monthNav}>
        <button type="button" style={styles.monthNavBtn} data-testid="calendar-month-prev" onClick={onPrev} aria-label="上一月">
          ‹
        </button>
        <div style={styles.monthTitle} data-testid="calendar-title">
          {viewYear}年{viewMonth}月
        </div>
        <button
          type="button"
          style={{
            ...styles.monthNavBtn,
            ...(atLatestMonth ? styles.monthNavBtnDisabled : {}),
          }}
          data-testid="calendar-month-next"
          onClick={onNext}
          disabled={atLatestMonth}
          aria-label="下一月"
        >
          ›
        </button>
      </div>

      {selectedIso && ap ? (
        <div style={styles.dayDetailStrip} data-testid="day-detail-strip">
          <div style={styles.calendarBadge}>
            <div style={styles.calWeek}>周{weekdayZh(ap.date)}</div>
            <div style={styles.calDate}>{ap.date}</div>
          </div>
          <div style={styles.dayDetailMetrics}>
            <div style={styles.dayDetailRow}>
              <span style={styles.dayDetailLabel}>较上日市值涨跌</span>
              <span style={{ ...styles.dayDetailValue, color: dMvColor }} data-testid="day-mv-pct">
                {dMvStr}
              </span>
            </div>
            <div style={styles.dayDetailRow}>
              <span style={styles.dayDetailLabel}>浮动盈亏增减</span>
              {dPlPnl ? (
                <span style={{ ...styles.dayDetailValue, color: dPlPnl.color }} data-testid="day-profit-delta">
                  {dPlPnl.text}
                </span>
              ) : (
                <span style={styles.dayDetailValue} data-testid="day-profit-delta">
                  —
                </span>
              )}
            </div>
            <div style={styles.dayDetailRow}>
              <span style={styles.dayDetailLabel} title="截至选中日期收盘的累计浮动盈亏">
                累计浮动盈亏
              </span>
              {cumPnl ? (
                <span style={{ ...styles.dayDetailValue, color: cumPnl.color }} data-testid="day-cumulative-pnl">
                  {cumPnl.text}
                </span>
              ) : (
                <span style={styles.dayDetailValue}>—</span>
              )}
            </div>
          </div>
        </div>
      ) : selectedIso && !ap ? (
        <div style={styles.dayDetailStripMuted} data-testid="day-detail-empty">
          <strong>{selectedIso}</strong>
          <span style={{ marginLeft: 8, color: '#8b8fa3' }}>该日无持仓快照</span>
        </div>
      ) : (
        <div style={styles.dayDetailStripMuted} data-testid="day-detail-empty">
          本月暂无快照数据，可切换其他月份查看
        </div>
      )}

      <div style={styles.chartHint}>
        格内为较<strong>上一快照日</strong>的浮动盈亏增减（元）；灰格无快照；不含佣金/利息；与券商对账请以<strong>对账单</strong>为准。
      </div>
      {profitCurveMeta?.hasCalendarGaps ? (
        <div style={styles.chartHintWarn} data-testid="profit-curve-gap-hint">
          检测到快照在交易日上不连续：部分格子合并了多日涨跌，与金阳光等「逐日」展示易不一致。重启服务后会尝试按历史K线补录缺失日；历史持仓若有变更则补录为近似值。
        </div>
      ) : null}

      <div style={styles.weekRow} data-testid="calendar-week-headers">
        {WEEK_HEADERS.map((w) => (
          <div key={w} style={styles.weekHeadCell}>
            {w}
          </div>
        ))}
      </div>
      <div style={styles.calGrid} data-testid="calendar-grid">
        {grid.map((cell, idx) => {
          const pt = byDate.get(cell.iso);
          const isSel = selectedIso === cell.iso;
          const vis = cellVisual(pt, isSel);
          if (!cell.inMonth) {
            return (
              <div
                key={`pad-${idx}-${cell.iso}`}
                style={{ ...styles.calCellPad, opacity: 0.38 }}
                data-testid={`calendar-pad-${cell.iso}`}
              >
                <span style={styles.calCellDay}>{cell.day}</span>
              </div>
            );
          }
          return (
            <button
              type="button"
              key={cell.iso}
              style={{
                ...styles.calCellBtn,
                background: vis.bg,
                border: vis.border,
                color: vis.color,
              }}
              data-testid={`calendar-cell-${cell.iso}`}
              onClick={() => setSelectedIso(cell.iso)}
              title={
                pt
                  ? pt.dayProfitDelta == null
                    ? `${cell.iso} 无上一日对比`
                    : `${cell.iso} 浮动盈亏增减 ¥${pt.dayProfitDelta.toFixed(2)}（较上一快照日）`
                  : `${cell.iso} 无快照`
              }
            >
              <span style={styles.calCellDay}>{cell.day}</span>
              {pt && pt.dayProfitDelta != null ? (
                <span style={styles.calCellPct}>{formatDayCellDeltaYuan(pt.dayProfitDelta)}</span>
              ) : pt ? (
                <span style={styles.calCellPctDim}>—</span>
              ) : (
                <span style={styles.calCellPctDim}>·</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'rgba(255,255,255,0.9)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderRadius: '16px',
    padding: '16px',
    marginBottom: '16px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    border: '1px solid rgba(255,255,255,0.6)',
    animation: 'fadeIn 0.3s ease',
    minWidth: 0,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    flexWrap: 'wrap' as const,
    gap: '8px',
  },
  title: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#1a1a2e',
    letterSpacing: '0.3px',
  },
  rangeHint: {
    fontSize: '11px',
    color: '#8b8fa3',
    padding: '4px 10px',
    borderRadius: '999px',
    background: 'rgba(102,126,234,0.08)',
  },
  skeleton: { padding: '20px 0' },
  skeletonBar: {
    height: '200px',
    borderRadius: '10px',
    background:
      'linear-gradient(90deg, rgba(139,143,163,0.08) 25%, rgba(139,143,163,0.15) 50%, rgba(139,143,163,0.08) 75%)',
    backgroundSize: '200% 100%',
  },
  empty: {
    textAlign: 'center' as const,
    padding: '32px 0',
    color: '#8b8fa3',
    fontSize: '14px',
  },
  emptyIcon: { fontSize: '32px', marginBottom: '8px' },
  emptyHint: { fontSize: '12px', color: '#b0b4c8', marginTop: '4px' },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px 14px',
    marginBottom: '12px',
    padding: '10px 12px',
    borderRadius: '12px',
    background: 'rgba(102,126,234,0.05)',
    border: '1px solid rgba(102,126,234,0.1)',
  },
  kpi: { minWidth: 0, textAlign: 'center' as const },
  kpiLabel: { fontSize: '10px', color: '#8b8fa3', marginBottom: '3px', fontWeight: 600, letterSpacing: '0.2px' },
  kpiValue: { fontSize: '16px', fontWeight: 800, color: '#1a1a2e', lineHeight: 1.2, whiteSpace: 'nowrap' as const },
  kpiValueSm: { fontSize: '14px', fontWeight: 800, lineHeight: 1.2, whiteSpace: 'nowrap' as const },
  kpiValueMuted: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#4a4a68',
    lineHeight: 1.2,
    whiteSpace: 'nowrap' as const,
  },
  monthNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    marginBottom: '12px',
  },
  monthNavBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    border: '1px solid rgba(102,126,234,0.25)',
    background: '#fff',
    color: '#667eea',
    fontSize: '20px',
    fontWeight: 700,
    cursor: 'pointer',
    lineHeight: 1,
    padding: 0,
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  monthNavBtnDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed' as const,
    boxShadow: 'none',
  },
  monthTitle: {
    fontSize: '17px',
    fontWeight: 800,
    color: '#1a1a2e',
    minWidth: '120px',
    textAlign: 'center' as const,
  },
  dayDetailStrip: {
    display: 'flex',
    flexWrap: 'nowrap' as const,
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    gap: '12px',
    padding: '12px 14px',
    marginBottom: '10px',
    borderRadius: '14px',
    background: 'linear-gradient(135deg, rgba(102,126,234,0.12) 0%, rgba(102,126,234,0.05) 100%)',
    border: '1px solid rgba(102,126,234,0.18)',
    fontSize: '13px',
    lineHeight: 1.35,
    minWidth: 0,
  },
  dayDetailStripMuted: {
    padding: '12px 14px',
    marginBottom: '10px',
    borderRadius: '14px',
    background: 'rgba(139,143,163,0.06)',
    fontSize: '13px',
    color: '#5c5f72',
  },
  calendarBadge: {
    flexShrink: 0,
    minWidth: '76px',
    padding: '8px 10px',
    borderRadius: '10px',
    background: 'linear-gradient(160deg, #fff 0%, rgba(255,255,255,0.94) 100%)',
    border: '1px solid rgba(102,126,234,0.28)',
    boxShadow: '0 2px 10px rgba(102,126,234,0.14)',
    textAlign: 'center' as const,
  },
  calWeek: { fontSize: '11px', color: '#667eea', fontWeight: 700, letterSpacing: '0.5px' },
  calDate: { fontSize: '14px', fontWeight: 800, color: '#1a1a2e', marginTop: '2px', letterSpacing: '0.2px' },
  dayDetailMetrics: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    justifyContent: 'center',
  },
  dayDetailRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: '8px 10px',
    alignItems: 'center',
    minWidth: 0,
  },
  dayDetailLabel: {
    color: '#8b8fa3',
    fontSize: '11px',
    fontWeight: 500,
    minWidth: 0,
    lineHeight: 1.35,
    whiteSpace: 'normal' as const,
  },
  dayDetailValue: {
    fontWeight: 700,
    fontSize: '13px',
    flexShrink: 0,
    textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const,
  },
  chartHint: {
    fontSize: '11px',
    color: '#b0b4c8',
    marginBottom: '6px',
    textAlign: 'center' as const,
    lineHeight: 1.45,
    padding: '0 4px',
  },
  chartHintWarn: {
    fontSize: '11px',
    color: '#ad6800',
    background: 'rgba(250,173,20,0.12)',
    border: '1px solid rgba(250,173,20,0.35)',
    borderRadius: '8px',
    padding: '8px 10px',
    marginBottom: '8px',
    lineHeight: 1.45,
    textAlign: 'left' as const,
  },
  weekRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: '4px',
    marginBottom: '4px',
    width: '100%',
    minWidth: 0,
  },
  weekHeadCell: {
    textAlign: 'center' as const,
    fontSize: '11px',
    fontWeight: 700,
    color: '#8b8fa3',
    padding: '4px 0',
    minWidth: 0,
  },
  calGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: '4px',
    gridAutoRows: 'minmax(56px, auto)',
    width: '100%',
    minWidth: 0,
  },
  calCellBtn: {
    minHeight: '56px',
    minWidth: 0,
    width: '100%',
    boxSizing: 'border-box' as const,
    borderRadius: '10px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: '2px',
    cursor: 'pointer',
    font: 'inherit',
    padding: '4px 3px',
    overflow: 'hidden',
    transition: 'transform 0.12s ease, box-shadow 0.12s ease',
  },
  calCellPad: {
    minHeight: '56px',
    minWidth: 0,
    width: '100%',
    boxSizing: 'border-box' as const,
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: '1px dashed rgba(0,0,0,0.04)',
  },
  calCellDay: { fontSize: '11px', fontWeight: 800, lineHeight: 1.05, flexShrink: 0, textAlign: 'center' as const },
  calCellPct: {
    fontSize: '8px',
    fontWeight: 700,
    lineHeight: 1.2,
    opacity: 0.95,
    textAlign: 'center' as const,
    whiteSpace: 'normal' as const,
    overflowWrap: 'anywhere' as const,
    wordBreak: 'break-word' as const,
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    padding: '0 1px',
    boxSizing: 'border-box' as const,
    overflow: 'hidden',
    letterSpacing: '0',
  },
  calCellPctDim: {
    fontSize: '10px',
    fontWeight: 600,
    opacity: 0.55,
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
    textAlign: 'center' as const,
    whiteSpace: 'normal' as const,
    overflowWrap: 'anywhere' as const,
  },
};

export default ProfitChart;
