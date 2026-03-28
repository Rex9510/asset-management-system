import React, { useEffect, useState, useRef, useMemo } from 'react';
import { getPositions, Position } from '../api/positions';
import { getDailyPicks, DailyPickMessage } from '../api/messages';
import { useMarketSSE } from '../hooks/useMarketSSE';
import MarketEnvTag from '../components/MarketEnvTag';
import RotationTag from '../components/RotationTag';
import SentimentTag from '../components/SentimentTag';
import CommodityChain from '../components/CommodityChain';
import EventCalendar from '../components/EventCalendar';
import DailyPickCard from '../components/DailyPickCard';
import CycleMonitor from '../components/CycleMonitor';

const DashboardPage: React.FC = () => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [dailyPicks, setDailyPicks] = useState<DailyPickMessage[]>([]);
  const stickyRef = useRef<HTMLDivElement>(null);
  const [stickyVisible, setStickyVisible] = useState(true);
  const stockCodes = useMemo(() => positions.map(p => p.stockCode), [positions]);
  const { quotes } = useMarketSSE(stockCodes);

  useEffect(() => {
    getPositions('holding').then(setPositions).catch(() => {});
    getDailyPicks().then(setDailyPicks).catch(() => {});
  }, []);

  useEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    const obs = new MutationObserver(() => {
      const hasVisible = Array.from(el.children).some((c) => (c as HTMLElement).offsetHeight > 0);
      setStickyVisible(hasVisible);
    });
    obs.observe(el, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  const summary = useMemo(() => {
    const holdings = positions.filter(p => p.positionType === 'holding');
    let asset = 0, cost = 0, today = 0;
    for (const p of holdings) {
      const quote = quotes.get(p.stockCode);
      const price = quote ? quote.price : (p.currentPrice || 0);
      const shares = p.shares || 0;
      asset += price * shares;
      cost += (p.costPrice || 0) * shares;
      if (quote && shares > 0) {
        const chg = quote.changePercent || 0;
        const prevClose = quote.price / (1 + chg / 100);
        today += (quote.price - prevClose) * shares;
      }
    }
    const pnl = asset - cost;
    const pct = cost > 0 ? (pnl / cost) * 100 : 0;
    return { totalAsset: asset, totalPnl: pnl, totalPnlPct: pct, todayPnl: today, hasPortfolio: holdings.length > 0 };
  }, [positions, quotes]);

  return (
    <div style={styles.page}>
      <div ref={stickyRef} style={{ ...styles.stickyHeader, display: stickyVisible ? 'block' : 'none' }}>
        {summary.hasPortfolio && (
          <div style={styles.portfolioBar}>
            <div style={styles.portfolioTop}>
              <div style={styles.totalAsset}>¥ {summary.totalAsset.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</div>
              <div style={styles.assetLabel}>总资产</div>
            </div>
            <div style={styles.pnlRow}>
              <span>今日 <span style={{ color: summary.todayPnl >= 0 ? '#ff4757' : '#2ed573' }}>{summary.todayPnl >= 0 ? '+' : ''}{summary.todayPnl.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span></span>
              <span>总盈亏 <span style={{ color: summary.totalPnl >= 0 ? '#ff4757' : '#2ed573' }}>{summary.totalPnl >= 0 ? '+' : ''}{summary.totalPnl.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} ({summary.totalPnlPct >= 0 ? '+' : ''}{summary.totalPnlPct.toFixed(2)}%)</span></span>
            </div>
          </div>
        )}
        <div style={styles.marketBar}><MarketEnvTag /><RotationTag /><SentimentTag /></div>
      </div>
      <div style={styles.content}>
        <CommodityChain />
        <EventCalendar />
        <div style={styles.picksCard}>
          <div style={styles.picksHeader}>
            <span style={styles.picksTitle}>🔍 今日关注</span>
            <span style={styles.picksDate}>{new Date().toISOString().slice(0, 10)}</span>
          </div>
          {dailyPicks.length === 0 ? <div style={styles.picksEmpty}>暂无今日关注</div> : dailyPicks.map((msg) => <DailyPickCard key={msg.id} message={msg} />)}
          <div style={styles.disclaimer}>以上内容仅供学习参考，不构成投资依据</div>
        </div>
        <CycleMonitor />
        <div style={{ height: '80px' }} />
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f5f6fa' },
  stickyHeader: { position: 'sticky' as const, top: 0, zIndex: 10 },
  portfolioBar: { background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', color: '#fff', padding: '10px 16px' },
  portfolioTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  totalAsset: { fontSize: '22px', fontWeight: 700 },
  assetLabel: { fontSize: '11px', color: '#aaa' },
  pnlRow: { display: 'flex', gap: '12px', fontSize: '11px', marginTop: '4px', color: '#ccc' },
  marketBar: { background: '#16213e', padding: '6px 16px 8px', display: 'flex', gap: '6px', overflowX: 'auto' as const },
  content: { padding: '12px' },
  picksCard: { background: 'linear-gradient(135deg, #f8f9ff 0%, #eef1ff 100%)', border: '1px solid #4a69bd', borderRadius: '12px', padding: '16px', marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  picksHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  picksTitle: { fontSize: '14px', fontWeight: 700, color: '#4a69bd' },
  picksDate: { fontSize: '11px', color: '#999' },
  picksEmpty: { textAlign: 'center' as const, padding: '20px 0', fontSize: '14px', color: '#999' },
  disclaimer: { fontSize: '10px', color: '#bbb', marginTop: '10px', textAlign: 'center' as const },
};

export default DashboardPage;
