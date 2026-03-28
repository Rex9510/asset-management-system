import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getNotificationSettings,
  updateNotificationSettings,
  NotificationSetting,
} from '../api/notification';

const TYPE_DESCRIPTIONS: Record<string, string> = {
  analysis: 'AI完成股票分析时通知',
  stop_loss_alert: '股价触及止损线时通知',
  rotation_switch: '板块轮动阶段切换时通知',
  chain_activation: '商品传导链节点激活时通知',
  event_window: '事件窗口期变化时通知',
  cycle_bottom: '检测到周期底部信号时通知',
  market_env_change: '大盘环境发生变化时通知',
  daily_pick_tracking: '每日关注追踪节点到达时通知',
  concentration_risk: '持仓集中度超阈值时通知',
  deep_report: '深度分析报告生成完成时通知',
  ambush: '发现埋伏推荐机会时通知',
  target_price: '股价触及目标价时通知',
};

function SkeletonItem() {
  return (
    <div style={styles.skeletonItem}>
      <div style={styles.skeletonLeft}>
        <div style={{ ...styles.skeletonLine, width: '50%' }} />
        <div style={{ ...styles.skeletonLine, width: '80%', marginTop: '8px', height: '12px' }} />
      </div>
      <div style={styles.skeletonToggle} />
    </div>
  );
}

const NotificationSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<NotificationSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const permissionRequested = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await getNotificationSettings();
        setSettings(data);
      } catch { /* silently ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  // Request browser notification permission on first visit
  useEffect(() => {
    if (permissionRequested.current) return;
    permissionRequested.current = true;
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => { /* silently degrade */ });
      }
    }
  }, []);

  const handleToggle = useCallback(async (messageType: string) => {
    // Optimistic update
    setSettings((prev) =>
      prev.map((s) =>
        s.messageType === messageType ? { ...s, enabled: !s.enabled } : s
      )
    );

    const target = settings.find((s) => s.messageType === messageType);
    if (!target) return;

    try {
      await updateNotificationSettings([
        { messageType, enabled: !target.enabled },
      ]);
    } catch {
      // Revert on failure
      setSettings((prev) =>
        prev.map((s) =>
          s.messageType === messageType ? { ...s, enabled: target.enabled } : s
        )
      );
    }
  }, [settings]);

  return (
    <div style={styles.container}>
      {/* Sticky Header */}
      <div style={styles.header}>
        <button
          type="button"
          style={styles.backBtn}
          onClick={() => navigate('/profile')}
          aria-label="返回"
          data-testid="back-btn"
        >
          ←
        </button>
        <span style={styles.headerTitle}>通知设置</span>
        <div style={{ width: '44px' }} />
      </div>

      {/* Content */}
      <div style={styles.content}>
        {loading ? (
          <div style={styles.card} data-testid="loading-state">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonItem key={i} />
            ))}
          </div>
        ) : settings.length === 0 ? (
          <div style={styles.emptyState} data-testid="empty-state">
            <div style={styles.emptyIcon}>🔔</div>
            <div style={styles.emptyText}>暂无通知类型</div>
          </div>
        ) : (
          <div style={styles.card}>
            {settings.map((setting, index) => (
              <div
                key={setting.messageType}
                style={{
                  ...styles.settingItem,
                  ...(index < settings.length - 1 ? styles.settingItemBorder : {}),
                }}
                data-testid={`setting-${setting.messageType}`}
              >
                <div style={styles.settingInfo}>
                  <div style={styles.settingLabel}>{setting.label}</div>
                  <div style={styles.settingDesc}>
                    {TYPE_DESCRIPTIONS[setting.messageType] || ''}
                  </div>
                </div>
                <button
                  type="button"
                  style={{
                    ...styles.toggle,
                    ...(setting.enabled ? styles.toggleOn : styles.toggleOff),
                  }}
                  onClick={() => handleToggle(setting.messageType)}
                  aria-label={`${setting.label} ${setting.enabled ? '已开启' : '已关闭'}`}
                  aria-checked={setting.enabled}
                  role="switch"
                  data-testid={`toggle-${setting.messageType}`}
                >
                  <div
                    style={{
                      ...styles.toggleKnob,
                      ...(setting.enabled ? styles.toggleKnobOn : styles.toggleKnobOff),
                    }}
                  />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={styles.footerNote}>
          关闭通知后，消息仍会保存在消息中心，仅不触发浏览器推送。
        </div>
      </div>
    </div>
  );
};

/* --- Styles --- */

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #f0f0ff 0%, #f8f9ff 100%)',
    paddingBottom: '24px',
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    boxShadow: '0 2px 12px rgba(102,126,234,0.3)',
  },
  backBtn: {
    width: '44px',
    height: '44px',
    border: 'none',
    background: 'rgba(255,255,255,0.15)',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
    transition: 'background 0.2s ease',
  },
  headerTitle: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '0.5px',
  },
  content: {
    padding: '16px',
  },
  card: {
    background: 'rgba(255,255,255,0.92)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderRadius: '16px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    border: '1px solid rgba(255,255,255,0.6)',
    overflow: 'hidden',
  },
  settingItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 18px',
    gap: '12px',
    transition: 'background 0.2s ease',
  },
  settingItemBorder: {
    borderBottom: '1px solid rgba(0,0,0,0.04)',
  },
  settingInfo: {
    flex: 1,
    minWidth: 0,
  },
  settingLabel: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#1a1a2e',
    lineHeight: '1.4',
  },
  settingDesc: {
    fontSize: '12px',
    color: '#8b8fa3',
    marginTop: '3px',
    lineHeight: '1.4',
  },
  toggle: {
    position: 'relative' as const,
    width: '52px',
    height: '30px',
    borderRadius: '15px',
    border: 'none',
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
    transition: 'background 0.25s ease',
    WebkitTapHighlightColor: 'transparent',
    minWidth: '52px',
    minHeight: '44px',
    display: 'flex',
    alignItems: 'center',
  },
  toggleOn: {
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
  },
  toggleOff: {
    background: '#ddd',
  },
  toggleKnob: {
    position: 'absolute' as const,
    top: '50%',
    width: '24px',
    height: '24px',
    borderRadius: '12px',
    background: '#fff',
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
    transition: 'left 0.25s ease, transform 0.25s ease',
    transform: 'translateY(-50%)',
  },
  toggleKnobOn: {
    left: '25px',
  },
  toggleKnobOff: {
    left: '3px',
  },
  footerNote: {
    fontSize: '12px',
    color: '#8b8fa3',
    textAlign: 'center' as const,
    marginTop: '16px',
    lineHeight: '1.6',
    padding: '0 8px',
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '60px 20px',
  },
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  emptyText: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#1a1a2e',
  },
  skeletonItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 18px',
    borderBottom: '1px solid rgba(0,0,0,0.04)',
  },
  skeletonLeft: {
    flex: 1,
  },
  skeletonLine: {
    height: '14px',
    borderRadius: '7px',
    background: 'linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%)',
    backgroundSize: '200% 100%',
  },
  skeletonToggle: {
    width: '52px',
    height: '30px',
    borderRadius: '15px',
    background: 'linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%)',
    backgroundSize: '200% 100%',
    flexShrink: 0,
  },
};

export default NotificationSettingsPage;
