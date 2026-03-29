import React from 'react';
import { useNavigate } from 'react-router-dom';

const AboutPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button type="button" style={styles.backBtn} onClick={() => navigate('/profile')} aria-label="返回" data-testid="back-btn">←</button>
        <span style={styles.headerTitle}>关于</span>
        <div style={{ width: 44 }} />
      </div>

      <div style={styles.content}>
        {/* App Info */}
        <div style={styles.appCard}>
          <div style={styles.appIcon}>📊</div>
          <div style={styles.appName} data-testid="app-name">投资喵</div>
          <div style={styles.appVersion} data-testid="app-version">v2.0.0</div>
        </div>

        {/* System Info */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>系统信息</div>
          <InfoRow label="AI引擎" value="DeepSeek V3" testId="ai-engine" />
          <InfoRow label="数据源" value="腾讯财经 / 新浪财经" testId="data-source" />
          <InfoRow label="更新时间" value={new Date().toLocaleDateString('zh-CN')} testId="update-time" />
          <InfoRow label="开发者" value="个人项目" testId="developer" />
        </div>

        {/* Disclaimer */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>免责声明</div>
          <div style={styles.disclaimer} data-testid="disclaimer">
            本应用所有分析结果仅供学习参考，不构成任何投资建议。AI分析基于历史数据和算法模型，无法预测未来市场走势。投资有风险，入市需谨慎。用户应根据自身情况独立做出投资决策，并承担相应风险。
          </div>
        </div>
      </div>
    </div>
  );
};

function InfoRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div style={styles.infoRow} data-testid={testId}>
      <span style={styles.infoLabel}>{label}</span>
      <span style={styles.infoValue}>{value}</span>
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
  content: { padding: 16 },
  appCard: {
    textAlign: 'center' as const, padding: '32px 20px', marginBottom: 16,
    background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(255,255,255,0.6)',
  },
  appIcon: { fontSize: 56, marginBottom: 12 },
  appName: { fontSize: 20, fontWeight: 700, color: '#1a1a2e', marginBottom: 4 },
  appVersion: { fontSize: 14, color: '#8b8fa3' },
  card: {
    background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    borderRadius: 16, padding: '16px 18px', marginBottom: 16,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(255,255,255,0.6)',
  },
  cardTitle: { fontSize: 15, fontWeight: 700, color: '#1a1a2e', marginBottom: 12, letterSpacing: 0.3 },
  infoRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.04)',
  },
  infoLabel: { fontSize: 14, color: '#8b8fa3' },
  infoValue: { fontSize: 14, fontWeight: 600, color: '#1a1a2e' },
  disclaimer: { fontSize: 14, color: '#e74c3c', lineHeight: 1.7, fontWeight: 500 },
};

export default AboutPage;
