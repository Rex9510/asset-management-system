import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';

interface DeepReportItem {
  id: number;
  stockCode: string;
  stockName: string;
  conclusion: string;
  fundamentals: string;
  financials: string;
  valuation: string;
  strategy: string;
  aiModel: string;
  confidence: number | null;
  dataCutoffDate: string;
  status: string;
  createdAt: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${m}-${day} ${h}:${min}`;
}

function SkeletonCard() {
  return (
    <div style={styles.skeletonCard}>
      <div style={{ ...styles.skeletonLine, width: '40%' }} />
      <div style={{ ...styles.skeletonLine, width: '80%', marginTop: 10 }} />
      <div style={{ ...styles.skeletonLine, width: '60%', marginTop: 8 }} />
    </div>
  );
}

const DeepReportHistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [reports, setReports] = useState<DeepReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/analysis/deep/history');
      setReports(res.data.reports || []);
    } catch { /* silently ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const toggleExpand = useCallback((id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button type="button" style={styles.backBtn} onClick={() => navigate('/profile')} aria-label="返回" data-testid="back-btn">←</button>
        <span style={styles.headerTitle}>历史深度报告</span>
        <div style={{ width: 44 }} />
      </div>

      <div style={styles.content}>
        {loading ? (
          <div data-testid="loading-state"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
        ) : reports.length === 0 ? (
          <div style={styles.emptyState} data-testid="empty-state">
            <div style={styles.emptyIcon}>📄</div>
            <div style={styles.emptyText}>暂无深度报告</div>
            <div style={styles.emptySub}>在个股分析页面点击"生成深度报告"即可创建</div>
          </div>
        ) : (
          reports.map((report) => (
            <div key={report.id} style={styles.card} data-testid="report-card">
              <div style={styles.cardHeader} onClick={() => toggleExpand(report.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') toggleExpand(report.id); }} aria-expanded={expandedId === report.id}>
                <div style={styles.cardTop}>
                  <span style={styles.stockInfo}>{report.stockName} ({report.stockCode})</span>
                  <span style={styles.time}>{formatDate(report.createdAt)}</span>
                </div>
                <div style={styles.conclusionPreview}>
                  {report.conclusion.length > 60 ? report.conclusion.slice(0, 60) + '...' : report.conclusion}
                </div>
                <div style={styles.cardMeta}>
                  {report.confidence != null && <span style={styles.confTag}>{report.confidence >= 80 ? '🟢' : report.confidence >= 60 ? '🟡' : '🔴'} {report.confidence}%</span>}
                  <span style={styles.expandArrow}>{expandedId === report.id ? '▲' : '▼'}</span>
                </div>
              </div>
              {expandedId === report.id && (
                <div style={styles.detail} data-testid="report-detail">
                  <DetailSection title="结论" text={report.conclusion} />
                  <DetailSection title="基本面" text={report.fundamentals} />
                  <DetailSection title="财务数据" text={report.financials} />
                  <DetailSection title="估值分析" text={report.valuation} />
                  <DetailSection title="交易策略" text={report.strategy} />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

function DetailSection({ title, text }: { title: string; text: string }) {
  return (
    <div style={styles.detailSection}>
      <div style={styles.detailLabel}>{title}</div>
      <div style={styles.detailText}>{text}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', background: 'linear-gradient(180deg, #f0f0ff 0%, #f8f9ff 100%)', paddingBottom: 24 },
  header: {
    position: 'sticky', top: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', background: 'linear-gradient(135deg, #667eea, #764ba2)', boxShadow: '0 2px 12px rgba(102,126,234,0.3)',
  },
  backBtn: {
    width: 44, height: 44, border: 'none', background: 'rgba(255,255,255,0.15)', borderRadius: 12,
    color: '#fff', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent', transition: 'background 0.2s ease',
  },
  headerTitle: { fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: 0.5 },
  content: { padding: '0 16px' },
  card: {
    background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    borderRadius: 14, marginBottom: 10, boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
    overflow: 'hidden', border: '1px solid rgba(255,255,255,0.6)', animation: 'fadeIn 0.3s ease',
  },
  cardHeader: { padding: 14, cursor: 'pointer' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  stockInfo: { fontSize: 15, fontWeight: 700, color: '#1a1a2e' },
  time: { fontSize: 12, color: '#8b8fa3' },
  conclusionPreview: { fontSize: 13, color: '#555', lineHeight: 1.6, marginBottom: 8 },
  cardMeta: { display: 'flex', alignItems: 'center', gap: 8 },
  modelTag: { fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(102,126,234,0.1)', color: '#667eea', fontWeight: 600 },
  confTag: { fontSize: 12, color: '#666', fontWeight: 500 },
  expandArrow: { marginLeft: 'auto', fontSize: 12, color: '#8b8fa3' },
  detail: { padding: '0 14px 14px', borderTop: '1px solid #f0f2f5' },
  detailSection: { marginTop: 12 },
  detailLabel: { fontSize: 12, color: '#8b8fa3', marginBottom: 4, fontWeight: 600 },
  detailText: { fontSize: 14, color: '#1a1a2e', lineHeight: 1.7 },
  emptyState: { textAlign: 'center' as const, padding: '60px 20px' },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 16, fontWeight: 600, color: '#1a1a2e', marginBottom: 6 },
  emptySub: { fontSize: 13, color: '#8b8fa3' },
  skeletonCard: {
    background: 'rgba(255,255,255,0.7)', borderRadius: 14, padding: 18, marginBottom: 10,
    boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
  },
  skeletonLine: {
    height: 14, borderRadius: 7,
    background: 'linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%)', backgroundSize: '200% 100%',
  },
};

export default DeepReportHistoryPage;
