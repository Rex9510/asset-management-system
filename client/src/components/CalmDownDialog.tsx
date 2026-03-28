import React from 'react';
import { CalmDownEvaluation } from '../api/chat';

export interface CalmDownDialogProps {
  evaluation: CalmDownEvaluation;
  onClose: () => void;
}

const CalmDownDialog: React.FC<CalmDownDialogProps> = ({ evaluation, onClose }) => {
  const isRational = evaluation.sellJudgment === 'rational';

  return (
    <div style={styles.overlay} role="dialog" aria-label="冷静分析" data-testid="calm-down-dialog">
      <div style={styles.dialog}>
        <div style={styles.header}>
          <span style={styles.headerIcon}>🧘</span>
          <span style={styles.headerTitle}>冷静一下</span>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>📋 买入逻辑回顾</div>
          <div style={styles.sectionContent}>{evaluation.buyLogicReview}</div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>🧠 卖出判断</div>
          <div style={{
            ...styles.judgmentBadge,
            background: isRational ? '#f6ffed' : '#fff2e8',
            color: isRational ? '#52c41a' : '#fa8c16',
            borderColor: isRational ? '#b7eb8f' : '#ffd591',
          }}>
            {isRational ? '✅ 理性卖出' : '⚠️ 情绪卖出'}
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>📉 最坏情况预估</div>
          <div style={styles.sectionContent}>{evaluation.worstCaseEstimate}</div>
        </div>

        {evaluation.recommendation && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>💡 参考方案</div>
            <div style={styles.sectionContent}>{evaluation.recommendation}</div>
          </div>
        )}

        <div style={styles.disclaimer}>
          仅供参考，不构成投资依据
        </div>

        <button
          type="button"
          style={styles.closeButton}
          onClick={onClose}
          aria-label="关闭冷静分析"
        >
          我已了解，继续操作
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.45)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    padding: '16px',
  },
  dialog: {
    background: '#fff',
    borderRadius: '20px',
    padding: '28px 22px',
    maxWidth: '360px',
    width: '100%',
    maxHeight: '80vh',
    overflowY: 'auto' as const,
    boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
    animation: 'slideUp 0.3s ease',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '22px',
    justifyContent: 'center',
  },
  headerIcon: {
    fontSize: '28px',
  },
  headerTitle: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#1a1a2e',
  },
  section: {
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#1a1a2e',
    marginBottom: '8px',
  },
  sectionContent: {
    fontSize: '13px',
    color: '#555',
    lineHeight: '1.7',
    background: '#f8f9fc',
    padding: '12px 14px',
    borderRadius: '12px',
    border: '1px solid #eef0f5',
  },
  judgmentBadge: {
    display: 'inline-block',
    padding: '8px 16px',
    borderRadius: '22px',
    fontSize: '14px',
    fontWeight: 700,
    border: '1px solid',
  },
  disclaimer: {
    fontSize: '12px',
    color: '#c0c4cc',
    textAlign: 'center' as const,
    marginBottom: '16px',
  },
  closeButton: {
    width: '100%',
    padding: '14px 0',
    border: 'none',
    borderRadius: '14px',
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px',
    boxShadow: '0 4px 12px rgba(102,126,234,0.3)',
  },
};

export default CalmDownDialog;
