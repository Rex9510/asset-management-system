import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSettings, updateSettings, UserSettings } from '../api/settings';

const FREQUENCIES = [
  { value: 30, label: '30分钟' },
  { value: 60, label: '60分钟' },
  { value: 120, label: '120分钟' },
];

const RISK_PREFS = [
  { value: 'conservative', label: '保守', desc: '偏好低风险、稳健型标的' },
  { value: 'balanced', label: '均衡', desc: '风险与收益兼顾' },
  { value: 'aggressive', label: '进取', desc: '追求高收益、可承受较大波动' },
];

function SkeletonBlock() {
  return (
    <div style={styles.skeletonBlock}>
      <div style={{ ...styles.skeletonLine, width: '30%' }} />
      <div style={{ ...styles.skeletonLine, width: '80%', marginTop: 12 }} />
      <div style={{ ...styles.skeletonLine, width: '60%', marginTop: 8 }} />
    </div>
  );
}

const TOGGLE_ITEMS = [
  { key: 'marketEnvLink', label: '大盘环境联动', desc: '根据大盘环境自动调整分析策略' },
  { key: 'selfCorrection', label: '自我修正', desc: '记录预测偏差，持续优化分析准确度' },
  { key: 'sentimentDetect', label: '情绪检测', desc: '检测市场情绪异常并提醒冷静操作' },
];

function getToggles(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem('analysisToggles');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { marketEnvLink: true, selfCorrection: true, sentimentDetect: true };
}

function saveToggles(toggles: Record<string, boolean>) {
  localStorage.setItem('analysisToggles', JSON.stringify(toggles));
}

const AnalysisSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggles, setToggles] = useState<Record<string, boolean>>(getToggles);

  useEffect(() => {
    (async () => {
      try {
        const data = await getSettings();
        setSettings(data);
      } catch { /* silently ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  const handleToggle = useCallback((key: string) => {
    setToggles(prev => {
      const updated = { ...prev, [key]: !prev[key] };
      saveToggles(updated);
      return updated;
    });
  }, []);

  const handleChange = useCallback(async (key: keyof UserSettings, value: string | number) => {
    if (!settings) return;
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    setSaving(true);
    try {
      await updateSettings({ [key]: value });
    } catch {
      setSettings(settings); // revert on failure
    } finally {
      setSaving(false);
    }
  }, [settings]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button type="button" style={styles.backBtn} onClick={() => navigate('/profile')} aria-label="返回" data-testid="back-btn">←</button>
        <span style={styles.headerTitle}>分析设置</span>
        <div style={{ width: '44px' }}>{saving && <span style={styles.savingDot}>●</span>}</div>
      </div>

      <div style={styles.content}>
        {loading ? (
          <div data-testid="loading-state"><SkeletonBlock /><SkeletonBlock /><SkeletonBlock /></div>
        ) : !settings ? (
          <div style={styles.emptyState} data-testid="empty-state">
            <div style={styles.emptyIcon}>⚙️</div>
            <div style={styles.emptyText}>无法加载设置</div>
          </div>
        ) : (
          <>
            <SettingSection title="分析频率" data-testid="freq-section">
              {FREQUENCIES.map((f) => (
                <RadioItem key={f.value} label={f.label} selected={settings.analysisFrequency === f.value} onSelect={() => handleChange('analysisFrequency', f.value)} testId={`freq-${f.value}`} />
              ))}
            </SettingSection>

            <SettingSection title="风险偏好" data-testid="risk-section">
              {RISK_PREFS.map((r) => (
                <RadioItem key={r.value} label={r.label} desc={r.desc} selected={settings.riskPreference === r.value} onSelect={() => handleChange('riskPreference', r.value)} testId={`risk-${r.value}`} />
              ))}
            </SettingSection>

            <SettingSection title="功能开关" data-testid="toggle-section">
              {TOGGLE_ITEMS.map((item) => (
                <ToggleItem key={item.key} label={item.label} desc={item.desc} checked={toggles[item.key] ?? true} onToggle={() => handleToggle(item.key)} testId={`toggle-${item.key}`} />
              ))}
            </SettingSection>
          </>
        )}
      </div>
    </div>
  );
};

function SettingSection({ title, children, ...rest }: { title: string; children: React.ReactNode; 'data-testid'?: string }) {
  return (
    <div style={styles.section} data-testid={rest['data-testid']}>
      <div style={styles.sectionTitle}>{title}</div>
      <div style={styles.card}>{children}</div>
    </div>
  );
}

function RadioItem({ label, desc, selected, onSelect, testId }: { label: string; desc?: string; selected: boolean; onSelect: () => void; testId: string }) {
  return (
    <button type="button" style={{ ...styles.radioItem, ...(selected ? styles.radioItemSelected : {}) }} onClick={onSelect} data-testid={testId} aria-pressed={selected}>
      <div style={styles.radioInfo}>
        <span style={{ ...styles.radioLabel, ...(selected ? styles.radioLabelSelected : {}) }}>{label}</span>
        {desc && <span style={styles.radioDesc}>{desc}</span>}
      </div>
      <span style={{ ...styles.radioCircle, ...(selected ? styles.radioCircleSelected : {}) }}>
        {selected && <span style={styles.radioInner} />}
      </span>
    </button>
  );
}

function ToggleItem({ label, desc, checked, onToggle, testId }: { label: string; desc: string; checked: boolean; onToggle: () => void; testId: string }) {
  return (
    <button type="button" style={{ ...styles.radioItem, ...(checked ? styles.radioItemSelected : {}) }} onClick={onToggle} data-testid={testId} aria-pressed={checked}>
      <div style={styles.radioInfo}>
        <span style={{ ...styles.radioLabel, ...(checked ? styles.radioLabelSelected : {}) }}>{label}</span>
        <span style={styles.radioDesc}>{desc}</span>
      </div>
      <div style={{ ...styles.toggleTrack, ...(checked ? styles.toggleTrackOn : {}) }}>
        <div style={{ ...styles.toggleThumb, ...(checked ? styles.toggleThumbOn : {}) }} />
      </div>
    </button>
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
  savingDot: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  content: { padding: 16 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: '#1a1a2e', marginBottom: 10, letterSpacing: 0.3 },
  card: {
    background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(255,255,255,0.6)', overflow: 'hidden',
  },
  radioItem: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
    padding: '14px 18px', border: 'none', borderBottom: '1px solid rgba(0,0,0,0.04)',
    background: 'transparent', cursor: 'pointer', minHeight: 44, textAlign: 'left' as const,
    WebkitTapHighlightColor: 'transparent', transition: 'background 0.2s ease',
  },
  radioItemSelected: { background: 'rgba(102,126,234,0.04)' },
  radioInfo: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  radioLabel: { fontSize: 15, fontWeight: 500, color: '#1a1a2e' },
  radioLabelSelected: { fontWeight: 700, color: '#667eea' },
  radioDesc: { fontSize: 12, color: '#8b8fa3' },
  radioCircle: {
    width: 22, height: 22, borderRadius: '50%', border: '2px solid #d0d0d8',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'border-color 0.2s ease',
  },
  radioCircleSelected: { borderColor: '#667eea' },
  radioInner: { width: 12, height: 12, borderRadius: '50%', background: '#667eea' },
  toggleTrack: {
    width: 44, height: 24, borderRadius: 12, background: '#d0d0d8', position: 'relative' as const,
    transition: 'background 0.2s ease', flexShrink: 0,
  },
  toggleTrackOn: { background: '#667eea' },
  toggleThumb: {
    width: 20, height: 20, borderRadius: '50%', background: '#fff', position: 'absolute' as const,
    top: 2, left: 2, transition: 'left 0.2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  },
  toggleThumbOn: { left: 22 },
  emptyState: { textAlign: 'center' as const, padding: '60px 20px' },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 16, fontWeight: 600, color: '#1a1a2e' },
  skeletonBlock: {
    background: 'rgba(255,255,255,0.7)', borderRadius: 14, padding: 18, marginBottom: 12,
    boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
  },
  skeletonLine: {
    height: 14, borderRadius: 7,
    background: 'linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%)', backgroundSize: '200% 100%',
  },
};

export default AnalysisSettingsPage;
