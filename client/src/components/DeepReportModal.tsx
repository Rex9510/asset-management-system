import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getDeepReport, DeepReport } from '../api/deepAnalysis';

interface DeepReportModalProps {
  stockCode: string;
  reportId: number;
  onClose: () => void;
}

const POLL_INTERVAL = 3000;

const DeepReportModal: React.FC<DeepReportModalProps> = ({ stockCode, reportId, onClose }) => {
  const [report, setReport] = useState<DeepReport | null>(null);
  const [error, setError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchReport = useCallback(async () => {
    try {
      const data = await getDeepReport(reportId);
      setReport(data);
      setError(false);
      if (data.status !== 'generating' && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch {
      setError(true);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [reportId]);

  useEffect(() => {
    fetchReport();
    pollRef.current = setInterval(fetchReport, POLL_INTERVAL);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [fetchReport]);

  const handleRetry = async () => {
    setRetrying(true);
    setError(false);
    try {
      const data = await getDeepReport(reportId);
      setReport(data);
      if (data.status === 'generating') {
        pollRef.current = setInterval(fetchReport, POLL_INTERVAL);
      }
    } catch {
      setError(true);
    } finally {
      setRetrying(false);
    }
  };

  const isLoading = !report || report.status === 'generating';
  const isFailed = report?.status === 'failed' || error;

  return (
    <div style={st.fullscreen} role="dialog" aria-modal="true" aria-label="深度分析报告" onClick={onClose}>
      <div style={st.container} onClick={(e) => e.stopPropagation()}>
        {/* 深色顶栏 sticky */}
        <div style={st.header}>
          <span style={st.headerTitle}>
            📋 深度分析报告
            {report?.stockName && (
              <span style={st.stockLabel}>{report.stockName}（{stockCode}）</span>
            )}
          </span>
          <button type="button" style={st.closeBtn} onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {/* 内容区 */}
        <div style={st.body}>
          {isFailed && !isLoading ? (
            <div style={st.errorState}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>😞</div>
              <div style={{ fontSize: '14px', color: '#8b8fa3', marginBottom: '16px' }}>报告生成失败</div>
              <button type="button" style={st.retryBtn} onClick={handleRetry} disabled={retrying}>
                {retrying ? '重试中...' : '🔄 重新获取'}
              </button>
            </div>
          ) : isLoading ? (
            <div style={st.loadingState}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔄</div>
              <div style={{ fontSize: '14px', color: '#8b8fa3', marginBottom: '20px' }}>
                AI正在生成深度分析报告，请稍候...
              </div>
              <div style={{ textAlign: 'left' as const }}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} style={{ marginBottom: '16px' }}>
                    <div style={st.skelTitle} />
                    <div style={st.skelLine} />
                    <div style={{ ...st.skelLine, width: '80%' }} />
                    <div style={{ ...st.skelLine, width: '60%' }} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* 结论先行 — 渐变背景 + 左侧蓝色强调线 */}
              {report!.conclusion && report!.conclusion !== '数据不足' && (
                <div style={st.conclusionCard} data-testid="deep-report-conclusion">
                  <div style={st.conclusionTitle}>📌 结论先行</div>
                  <div style={st.conclusionText}>{report!.conclusion}</div>
                </div>
              )}

              {/* 基本面 — 结构化：核心逻辑 + 要点列表 */}
              {report!.fundamentals && report!.fundamentals !== '数据不足' && (
                <div style={st.card}>
                  <div style={st.cardTitle}>📊 基本面分析</div>
                  <FundamentalsSection text={report!.fundamentals} />
                </div>
              )}

              {/* 财务数据 — 尝试解析为网格小卡片 */}
              {report!.financials && report!.financials !== '数据不足' && (
                <div style={st.card}>
                  <div style={st.cardTitle}>💰 核心财务数据</div>
                  <FinancialsGrid text={report!.financials} />
                </div>
              )}

              {/* 估值分位 — 尝试解析为进度条 */}
              {report!.valuation && report!.valuation !== '数据不足' && (
                <div style={st.card}>
                  <div style={st.cardTitle}>📐 估值分位</div>
                  <ValuationBars text={report!.valuation} />
                </div>
              )}

              {/* 交易策略 — 结构化分段 */}
              {report!.strategy && report!.strategy !== '数据不足' && (
                <div style={st.card}>
                  <div style={st.cardTitle}>🎯 交易策略</div>
                  <StrategySection text={report!.strategy} />
                </div>
              )}

              {/* 底部信息 */}
              <div style={st.disclaimer}>以上内容仅供学习参考，不构成投资依据</div>
              <div style={st.footerTime}>数据生成时间：{report!.dataCutoffDate}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/* 解析财务数据：优先解析结构化格式 "营收(亿):1505|净利(亿):738|ROE:31.2%"，fallback 到正则 */
function parseFinancials(text: string): { label: string; value: string }[] {
  const items: { label: string; value: string }[] = [];

  // 预处理：只取第一行有效数据（去掉AI可能附加的注释文字）
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const dataLine = lines.find(l => l.includes('|') && l.includes(':')) || text;

  // 1. 尝试结构化格式：用 | 分隔的 key:value 对
  const pipeSegments = dataLine.split('|').map(s => s.trim()).filter(Boolean);
  if (pipeSegments.length >= 2) {
    for (const seg of pipeSegments) {
      const colonIdx = seg.indexOf(':');
      if (colonIdx > 0) {
        const label = seg.slice(0, colonIdx).trim();
        let value = seg.slice(colonIdx + 1).trim();
        // 截断：只保留数值部分，去掉可能的注释
        value = value.replace(/\s*[\*（(].*$/, '').trim();
        if (label && value) items.push({ label, value });
      }
    }
    if (items.length >= 2) return items;
    items.length = 0; // reset if pipe parsing didn't yield enough
  }

  // 2. Fallback: 正则匹配常见财务指标
  const patterns = [
    /营收[（(]亿[)）]?\s*[:：]\s*([\d,.]+)/i,
    /净利[润]?[（(]亿[)）]?\s*[:：]\s*([\d,.]+)/i,
    /ROE\s*[:：]\s*([\d,.]+%?)/i,
    /毛利率\s*[:：]\s*([\d,.]+%?)/i,
    /PE\s*[（(]?TTM[)）]?\s*[:：]\s*([\d,.]+)/i,
    /股息率\s*[:：]\s*([\d,.]+%?)/i,
    /净利润率\s*[:：]\s*([\d,.]+%?)/i,
    /资产负债率\s*[:：]\s*([\d,.]+%?)/i,
    /营收同比\s*[:：]\s*([+\-]?[\d,.]+%?)/i,
    /净利同比\s*[:：]\s*([+\-]?[\d,.]+%?)/i,
    /PB\s*[:：]\s*([\d,.]+)/i,
    /PS\s*[:：]\s*([\d,.]+)/i,
  ];
  const labels = [
    '营收(亿)', '净利(亿)', 'ROE', '毛利率', 'PE(TTM)', '股息率',
    '净利润率', '资产负债率', '营收同比', '净利同比', 'PB', 'PS',
  ];
  patterns.forEach((p, i) => {
    const m = text.match(p);
    if (m) items.push({ label: labels[i], value: m[1] });
  });
  return items;
}

/* 财务数据网格：3列小卡片，解析失败则 fallback 纯文本 */
const FinancialsGrid: React.FC<{ text: string }> = ({ text }) => {
  const items = parseFinancials(text);
  if (items.length < 2) {
    return <div style={st.cardContent}>{text}</div>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
      {items.map((item) => (
        <div key={item.label} style={{
          textAlign: 'center' as const, padding: '10px',
          background: '#f8f9ff', borderRadius: '8px',
          overflow: 'hidden',
        }}>
          <div style={{ fontSize: '12px', color: '#999' }}>{item.label}</div>
          <div style={{
            fontSize: '16px', fontWeight: 700, color: '#333', marginTop: '2px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
};

/* 解析估值分位：优先解析结构化格式 "PE:55:合理|PB:62:合理|PS:48:合理"，fallback 到正则 */
function parseValuation(text: string): { label: string; pct: number; status: string }[] {
  const items: { label: string; pct: number; status: string }[] = [];

  // 1. 尝试结构化格式：PE:55:合理|PB:62:合理
  const pipeSegments = text.split('|').map(s => s.trim()).filter(Boolean);
  if (pipeSegments.length >= 1) {
    for (const seg of pipeSegments) {
      const parts = seg.split(':').map(s => s.trim());
      if (parts.length >= 3) {
        const label = parts[0].toUpperCase();
        const pct = parseFloat(parts[1]);
        const status = parts[2];
        if (['PE', 'PB', 'PS'].includes(label) && !isNaN(pct) && pct >= 0 && pct <= 100 && ['低估', '合理', '高估'].includes(status)) {
          items.push({ label: label + '分位', pct, status });
        }
      }
    }
    if (items.length >= 1) return items;
    items.length = 0;
  }

  // 2. Fallback: 正则匹配
  const re = /(PE|PB|PS)[^分]*分位[数]?\s*[:：]?\s*(?:约|为|处于|在)?\s*([\d.]+)\s*%/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const pct = parseFloat(m[2]);
    if (!isNaN(pct) && pct >= 0 && pct <= 100) {
      let status = '合理';
      if (pct <= 30) status = '低估';
      else if (pct >= 70) status = '高估';
      items.push({ label: m[1].toUpperCase() + '分位', pct, status });
    }
  }
  if (items.length > 0) return items;

  // 3. 尝试匹配 "PE...XX%分位"
  const altRe = /(PE|PB|PS)[^%]*?([\d.]+)\s*%\s*分位/gi;
  while ((m = altRe.exec(text)) !== null) {
    const pct = parseFloat(m[2]);
    if (!isNaN(pct) && pct >= 0 && pct <= 100) {
      let status = '合理';
      if (pct <= 30) status = '低估';
      else if (pct >= 70) status = '高估';
      items.push({ label: m[1].toUpperCase() + '分位', pct, status });
    }
  }
  if (items.length > 0) return items;

  // 4. 尝试匹配 "PE和PB分位数均为78.36%"
  const combinedRe = /(PE)\s*和\s*(PB)\s*分位[数]?\s*均为\s*([\d.]+)\s*%/i;
  const cm = text.match(combinedRe);
  if (cm) {
    const pct = parseFloat(cm[3]);
    if (!isNaN(pct) && pct >= 0 && pct <= 100) {
      let status = '合理';
      if (pct <= 30) status = '低估';
      else if (pct >= 70) status = '高估';
      items.push({ label: 'PE分位', pct, status });
      items.push({ label: 'PB分位', pct, status });
    }
  }
  return items;
}

function getValuationColor(pct: number): string {
  if (pct <= 30) return '#2ed573';  // 低估绿
  if (pct >= 70) return '#ff4757';  // 高估红
  return '#ffa502';                  // 合理橙
}

/* 估值分位进度条：解析失败则 fallback 纯文本 */
const ValuationBars: React.FC<{ text: string }> = ({ text }) => {
  const items = parseValuation(text);
  if (items.length === 0) {
    return <div style={st.cardContent}>{text}</div>;
  }
  return (
    <div>
      {items.map((item) => {
        const color = getValuationColor(item.pct);
        return (
          <div key={item.label} style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
              <span style={{ color: '#333' }}>{item.label}</span>
              <span style={{ color }}>{item.pct}% {item.status}</span>
            </div>
            <div style={{ height: '6px', background: '#f0f0f0', borderRadius: '3px' }}>
              <div style={{
                width: `${item.pct}%`, height: '100%',
                background: color, borderRadius: '3px',
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* 解析交易策略：将【标题】分段解析为结构化块 */
function parseStrategy(text: string): { title: string; content: string }[] {
  const sections: { title: string; content: string }[] = [];
  // 匹配 【xxx】 标记的段落
  const re = /【([^】]+)】/g;
  let match;
  const markers: { title: string; index: number }[] = [];
  while ((match = re.exec(text)) !== null) {
    markers.push({ title: match[1], index: match.index + match[0].length });
  }
  if (markers.length === 0) return [];
  for (let i = 0; i < markers.length; i++) {
    const end = i + 1 < markers.length ? text.lastIndexOf('【', markers[i + 1].index) : text.length;
    const content = text.slice(markers[i].index, end).trim();
    if (content) sections.push({ title: markers[i].title, content });
  }
  return sections;
}

/* 交易策略组件：结构化分段显示 */
const StrategySection: React.FC<{ text: string }> = ({ text }) => {
  const sections = parseStrategy(text);
  if (sections.length === 0) {
    // fallback: 纯文本
    return <div style={st.cardContent}>{text}</div>;
  }
  return (
    <div>
      {sections.map((sec, i) => (
        <div key={i} style={{ marginBottom: i < sections.length - 1 ? '14px' : 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#4a69bd', marginBottom: '4px' }}>
            {sec.title}
          </div>
          <div style={{ fontSize: '13px', lineHeight: '1.8', color: '#555', whiteSpace: 'pre-wrap' as const }}>
            {sec.content}
          </div>
        </div>
      ))}
    </div>
  );
};

/* 基本面分析组件：将核心逻辑和•要点分开展示 */
const FundamentalsSection: React.FC<{ text: string }> = ({ text }) => {
  // 按 • 或 · 分割为段落和要点
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const narrative: string[] = [];
  const bullets: string[] = [];

  for (const line of lines) {
    if (/^[•·\-\*]/.test(line)) {
      bullets.push(line.replace(/^[•·\-\*]\s*/, ''));
    } else {
      // 检查行内是否有 • 分隔的多个要点（AI有时一行写完）
      const inlineBullets = line.split(/[•·]/).map(s => s.trim()).filter(Boolean);
      if (inlineBullets.length >= 3) {
        // 第一段可能是叙述，后面是要点
        if (narrative.length === 0 && !line.startsWith('•') && !line.startsWith('·')) {
          narrative.push(inlineBullets[0]);
          for (let i = 1; i < inlineBullets.length; i++) bullets.push(inlineBullets[i]);
        } else {
          for (const b of inlineBullets) bullets.push(b);
        }
      } else {
        narrative.push(line);
      }
    }
  }

  return (
    <div>
      {narrative.length > 0 && (
        <div style={{
          fontSize: '13px', lineHeight: '1.8', color: '#444',
          marginBottom: bullets.length > 0 ? '12px' : 0,
          padding: '10px 12px',
          background: 'linear-gradient(135deg, #f0f4ff, #f8f9ff)',
          borderRadius: '8px', borderLeft: '3px solid #667eea',
        }}>
          {narrative.join('\n')}
        </div>
      )}
      {bullets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {bullets.map((b, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px',
              fontSize: '13px', lineHeight: '1.6', color: '#555',
            }}>
              <span style={{
                flexShrink: 0, width: '6px', height: '6px',
                borderRadius: '50%', background: '#667eea',
                marginTop: '7px',
              }} />
              <span>{b}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* 样式：完全对齐原型 report-modal 全屏设计 */
const st: Record<string, React.CSSProperties> = {
  /* 全屏覆盖层 */
  fullscreen: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: '#fff',
    zIndex: 200,
    display: 'flex',
    justifyContent: 'center',
  },
  /* 内容容器，限制最大宽度 */
  container: {
    width: '100%',
    maxWidth: '428px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#fff',
    overflowY: 'auto' as const,
  },
  /* 深色顶栏 sticky */
  header: {
    background: '#1a1a2e',
    color: '#fff',
    padding: '12px 16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: '17px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap' as const,
  },
  stockLabel: {
    fontSize: '13px',
    fontWeight: 400,
    color: 'rgba(255,255,255,0.6)',
  },
  closeBtn: {
    width: '44px',
    height: '44px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'none',
    fontSize: '20px',
    color: '#fff',
    cursor: 'pointer',
    flexShrink: 0,
  },
  /* 内容区 — 白色背景 */
  body: {
    flex: 1,
    padding: '16px',
    background: '#fff',
  },
  /* 结论先行卡片 — 渐变背景 + 左侧蓝色强调线 */
  conclusionCard: {
    background: 'linear-gradient(135deg, #f8f9ff, #eef1ff)',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '16px',
    borderLeft: '4px solid #4a69bd',
  },
  conclusionTitle: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#4a69bd',
    marginBottom: '8px',
  },
  conclusionText: {
    fontSize: '13px',
    lineHeight: '1.8',
    color: '#555',
    whiteSpace: 'pre-wrap' as const,
  },
  /* 普通内容卡片 — 白底 + 阴影 */
  card: {
    background: '#fff',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '16px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  cardTitle: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#333',
    marginBottom: '10px',
  },
  cardContent: {
    fontSize: '13px',
    lineHeight: '1.8',
    color: '#555',
    whiteSpace: 'pre-wrap' as const,
  },
  /* 底部 */
  disclaimer: {
    fontSize: '12px',
    color: '#999',
    textAlign: 'center' as const,
    padding: '16px 0 4px',
  },
  footerTime: {
    fontSize: '11px',
    color: '#bbb',
    textAlign: 'center' as const,
    paddingBottom: '16px',
  },
  /* 加载 & 错误 */
  loadingState: {
    textAlign: 'center' as const,
    padding: '20px 0',
  },
  errorState: {
    textAlign: 'center' as const,
    padding: '40px 0',
  },
  retryBtn: {
    padding: '10px 24px',
    border: 'none',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px',
  },
  skelTitle: {
    width: '120px',
    height: '18px',
    background: 'linear-gradient(90deg, #f0f2f5 25%, #e8eaf0 50%, #f0f2f5 75%)',
    borderRadius: '6px',
    marginBottom: '8px',
  },
  skelLine: {
    width: '100%',
    height: '14px',
    background: 'linear-gradient(90deg, #f0f2f5 25%, #e8eaf0 50%, #f0f2f5 75%)',
    borderRadius: '4px',
    marginBottom: '6px',
  },
};

export default DeepReportModal;
