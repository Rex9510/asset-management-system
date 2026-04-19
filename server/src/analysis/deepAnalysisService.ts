/**
 * 深度分析报告服务
 *
 * 按语风swiss分析框架生成深度分析报告：
 * 结论先行 → 基本面 → 财务数据 → 估值分位 → 交易策略
 *
 * 特性：
 * - 24h缓存跨用户共享（同一股票）
 * - 60秒超时返回"报告生成中"，后台继续生成
 * - 使用"参考方案"措辞，禁止"建议"/"推荐"
 * - 完成后创建 deep_report 消息
 */
import Database from 'better-sqlite3';
import axios from 'axios';
import { getDatabase } from '../db/connection';
import { getAIProvider } from '../ai/aiProviderFactory';
import { buildAnalysisContext } from './analysisService';
import { getValuationFromDb, getHistoricalPrices } from '../valuation/valuationService';
import { getQuote, getMarketPrefix } from '../market/marketDataService';

// --- Types ---

export interface DeepReport {
  id: number;
  userId: number;
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
  status: 'generating' | 'completed' | 'failed';
  createdAt: string;
}

interface DeepReportRow {
  id: number;
  user_id: number;
  stock_code: string;
  stock_name: string;
  conclusion: string;
  fundamentals: string;
  financials: string;
  valuation: string;
  strategy: string;
  ai_model: string;
  confidence: number | null;
  data_cutoff_date: string;
  status: string;
  created_at: string;
}

// --- Helpers ---

function toDeepReport(row: DeepReportRow): DeepReport {
  return {
    id: row.id,
    userId: row.user_id,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    conclusion: row.conclusion,
    fundamentals: row.fundamentals,
    financials: row.financials,
    valuation: row.valuation,
    strategy: row.strategy,
    aiModel: row.ai_model,
    confidence: row.confidence,
    dataCutoffDate: row.data_cutoff_date,
    status: row.status as DeepReport['status'],
    createdAt: row.created_at,
  };
}

// --- 24h Cache ---

function findCachedReport(stockCode: string, db: Database.Database): DeepReport | null {
  // Use a computed cutoff to handle both ISO and SQLite datetime formats
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const row = db.prepare(
    `SELECT * FROM deep_reports
     WHERE stock_code = ? AND status = 'completed'
     AND created_at > ?
     ORDER BY created_at DESC LIMIT 1`
  ).get(stockCode, cutoff) as DeepReportRow | undefined;
  return row ? toDeepReport(row) : null;
}

// --- Fetch core financial data from Tencent ---

export interface FinancialMetrics {
  revenue: string;      // 营收(亿)
  netProfit: string;    // 净利(亿)
  roe: string;          // ROE
  grossMargin: string;  // 毛利率
  peTtm: string;        // PE(TTM)
  dividendYield: string; // 股息率
  pbValue: string;      // PB
  totalMarketCap: number; // 总市值(亿)，用于算PS
}

/**
 * 多接口互补获取核心财务指标
 * 策略：每个接口尽量多拿字段，缺啥用下一个接口补
 * 
 * 接口1: 东方财富push2 — PE(f39/f9), PB(f23), 股息率(f173), 总市值(f20)
 * 接口2: 腾讯行情 qt.gtimg.cn — PE(parts[39]), PB(parts[46])
 * 接口3: 东方财富F10财务摘要 — 营收, 净利, ROE, 毛利率
 * 接口4: 估值缓存 — PE, PB (兜底)
 */
export async function fetchFinancialData(stockCode: string, db?: Database.Database): Promise<FinancialMetrics> {
  const m: FinancialMetrics = {
    revenue: '--', netProfit: '--', roe: '--',
    grossMargin: '--', peTtm: '--', dividendYield: '--',
    pbValue: '--', totalMarketCap: 0,
  };

  const database = db || getDatabase();

  // --- 接口1: 东方财富push2（一次拿多个字段）---
  try {
    const secid = stockCode.startsWith('6') ? `1.${stockCode}` : `0.${stockCode}`;
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f9,f23,f20,f173`;
    const resp = await axios.get(url, { timeout: 5000 });
    const d = resp.data?.data;
    if (d) {
      // f9 = PE(TTM动态)
      if (d.f9 != null && !isNaN(parseFloat(String(d.f9))) && parseFloat(String(d.f9)) > 0) {
        m.peTtm = parseFloat(String(d.f9)).toFixed(2);
      }
      // f23 = PB
      if (d.f23 != null && !isNaN(parseFloat(String(d.f23))) && parseFloat(String(d.f23)) > 0) {
        m.pbValue = parseFloat(String(d.f23)).toFixed(2);
      }
      // f20 = 总市值（单位：元），转亿
      if (d.f20 != null && !isNaN(parseFloat(String(d.f20))) && parseFloat(String(d.f20)) > 0) {
        m.totalMarketCap = parseFloat(String(d.f20)) / 100000000;
      }
      // f173 = 股息率
      if (d.f173 != null && String(d.f173) !== '-' && !isNaN(parseFloat(String(d.f173)))) {
        const dy = parseFloat(String(d.f173));
        if (dy > 0) m.dividendYield = dy.toFixed(2) + '%';
      }
    }
  } catch {
    // push2失败，继续用其他接口补
  }

  // --- 接口2: 腾讯行情（补PE/PB）---
  try {
    const prefix = getMarketPrefix(stockCode);
    const symbol = `${prefix}${stockCode}`;
    const url = `https://qt.gtimg.cn/q=${symbol}`;
    const resp = await axios.get(url, { timeout: 5000, responseType: 'arraybuffer' });
    const text = new TextDecoder('gbk').decode(Buffer.from(resp.data));
    const match = text.match(/"(.+)"/);
    if (match?.[1]) {
      const parts = match[1].split('~');
      if (parts.length > 46) {
        // parts[39]=PE(TTM), parts[46]=PB
        if (m.peTtm === '--') {
          const pe = parseFloat(parts[39]);
          if (!isNaN(pe) && pe > 0) m.peTtm = pe.toFixed(2);
        }
        if (m.pbValue === '--') {
          const pb = parseFloat(parts[46]);
          if (!isNaN(pb) && pb > 0) m.pbValue = pb.toFixed(2);
        }
      }
    }
  } catch {
    // 腾讯失败，继续
  }

  // --- 接口3: 东方财富F10财务摘要（营收/净利/ROE/毛利率）---
  const emPrefix = stockCode.startsWith('6') ? 'SH' : 'SZ';
  try {
    const finUrl = `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${emPrefix}${stockCode}`;
    const finResp = await axios.get(finUrl, { timeout: 8000 });
    const latest = finResp.data?.data?.[0];
    if (latest) {
      if (latest.TOTALOPERATEREVE != null) {
        m.revenue = (latest.TOTALOPERATEREVE / 100000000).toFixed(2);
      }
      if (latest.PARENTNETPROFIT != null) {
        m.netProfit = (latest.PARENTNETPROFIT / 100000000).toFixed(2);
      }
      if (latest.ROEJQ != null) {
        m.roe = latest.ROEJQ.toFixed(2) + '%';
      }
      if (latest.XSMLL != null) {
        m.grossMargin = latest.XSMLL.toFixed(2) + '%';
      } else if (latest.XSJLL != null) {
        m.grossMargin = latest.XSJLL.toFixed(2) + '%';
      }
    }
  } catch {
    // 东财F10失败，继续
  }

  // --- 接口4: 估值缓存兜底（补PE/PB）---
  const valuation = getValuationFromDb(stockCode, database);
  if (m.peTtm === '--' && valuation?.peValue) {
    m.peTtm = valuation.peValue.toFixed(2);
  }
  if (m.pbValue === '--' && valuation?.pbValue) {
    m.pbValue = valuation.pbValue.toFixed(2);
  }

  return m;
}


function buildFinancialDataString(metrics: FinancialMetrics): string {
  // 计算PS = 总市值(亿) / 营收(亿)
  const revenue = parseFloat(metrics.revenue);
  const marketCap = metrics.totalMarketCap;
  const psValue = (revenue > 0 && marketCap > 0) ? (marketCap / revenue).toFixed(2) : '--';

  return `已获取的财务数据（请直接使用这些数值，--表示未获取到需要你补充）：
营收(亿):${metrics.revenue}|净利(亿):${metrics.netProfit}|ROE:${metrics.roe}|毛利率:${metrics.grossMargin}|PE(TTM):${metrics.peTtm}|PB:${metrics.pbValue}|PS:${psValue}|股息率:${metrics.dividendYield}`;
}

// --- AI Prompt ---

function buildDeepAnalysisPrompt(
  stockName: string,
  stockCode: string,
  price: number,
  indicatorsSummary: string,
  valuationSummary: string,
  newsTitles: string,
  today: string,
  financialDataStr: string
): string {
  return `你是A股分析师，输出要求极简、数据驱动、零废话。

股票：${stockName}（${stockCode}），现价${price}
技术：${indicatorsSummary}
${valuationSummary}
${financialDataStr}
新闻：${newsTitles || '暂无'}

严格按以下结构输出（用===分隔），每段尽量短，用•列要点，带具体数字，不要写解释性段落：

=== 结论 ===
一句话：当前阶段+参考方案+置信度，如"主升浪中段，参考方案：持有，置信度78%"

=== 基本面 ===
先用2-3句话详细说清楚这只股票的核心买入逻辑：它在什么行业、有什么独特竞争优势、当前处于什么发展阶段、为什么现在值得关注。要具体到业务层面，不要泛泛而谈。
然后换行，用•列出4-5个关键数据要点（每个•独占一行），如：
• Q3营收同比+15.2%，连续3季加速
• ROE 18.5%，行业前10%
• 毛利率32%，同比提升2.1个百分点

=== 财务数据 ===
直接原样输出上面"已获取的财务数据"那行pipe格式。如果某项为--，请根据你对该股票的了解补充合理数值替换--，确保没有--

=== 估值分位 ===
PE:百分比:状态|PB:百分比:状态|PS:百分比:状态
状态只能是：低估、合理、高估
上面估值分位数据中已有PE/PB/PS的百分位，请直接使用，如果缺少PS则根据行业合理估算

=== 交易策略 ===
【利润仓】目标价xx，止损xx（距当前-x%）
【底仓】长期目标xx-xx
【加仓条件】回调至xx以下可考虑

规则：用"参考方案"不用"建议/推荐"；财务数据中--的项必须补充合理数值；每段不超过4行；日期${today}`;
}

// --- Parse AI Response ---

export function parseDeepAnalysisResponse(text: string): {
  conclusion: string;
  fundamentals: string;
  financials: string;
  valuation: string;
  strategy: string;
} {
  const sectionMap: [string, string][] = [
    ['结论', 'conclusion'],
    ['基本面', 'fundamentals'],
    ['财务数据', 'financials'],
    ['估值分位', 'valuation'],
    ['交易策略', 'strategy'],
  ];

  const result: Record<string, string> = {};

  // Match sections delimited by === SectionName ===
  for (let i = 0; i < sectionMap.length; i++) {
    const [cnName, key] = sectionMap[i];
    // Build regex: === 结论 === ... (until next === or end)
    const pattern = new RegExp(
      `===\\s*${cnName}\\s*===([\\s\\S]*?)(?====\\s*(?:${sectionMap.map(([n]) => n).join('|')})\\s*===|$)`
    );
    const match = text.match(pattern);
    result[key] = match ? match[1].trim() : '';
  }

  return {
    conclusion: result.conclusion || '分析生成中',
    fundamentals: result.fundamentals || '数据不足',
    financials: result.financials || '数据不足',
    valuation: result.valuation || '数据不足',
    strategy: result.strategy || '数据不足',
  };
}

// --- Build context summaries ---

function buildIndicatorsSummary(context: Awaited<ReturnType<typeof buildAnalysisContext>>): string {
  const parts: string[] = [];
  const ti = context.technicalIndicators;
  if (ti.ma) {
    parts.push(`MA5=${ti.ma.ma5} MA10=${ti.ma.ma10} MA20=${ti.ma.ma20} MA60=${ti.ma.ma60}`);
  }
  if (ti.macd) {
    parts.push(`MACD DIF=${ti.macd.dif} DEA=${ti.macd.dea} HIST=${ti.macd.histogram}`);
  }
  if (ti.kdj) {
    parts.push(`KDJ K=${ti.kdj.k} D=${ti.kdj.d} J=${ti.kdj.j}`);
  }
  if (ti.rsi) {
    parts.push(`RSI6=${ti.rsi.rsi6} RSI12=${ti.rsi.rsi12} RSI24=${ti.rsi.rsi24}`);
  }
  return parts.length > 0 ? parts.join('，') : '暂无技术指标数据';
}

function buildValuationSummary(
  valuationData: ReturnType<typeof getValuationFromDb>,
  financialMetrics?: FinancialMetrics,
  historicalPrices?: { tradeDate: string; closePrice: number }[]
): string {
  if (!valuationData) return '估值分位：暂无数据';

  let summary = `估值分位：PE ${valuationData.pePercentile}%分位（${valuationData.peZone}），PB ${valuationData.pbPercentile}%分位（${valuationData.pbZone}）`;

  // 计算PS分位：PS = 总市值 / 营收
  if (financialMetrics && historicalPrices && historicalPrices.length > 0) {
    const revenue = parseFloat(financialMetrics.revenue);
    const marketCap = financialMetrics.totalMarketCap;
    if (revenue > 0 && marketCap > 0) {
      const currentPs = marketCap / revenue;
      // 反推历史PS序列：历史PS = 当前PS × 历史价 / 当前价
      const currentPrice = historicalPrices[historicalPrices.length - 1]?.closePrice;
      if (currentPrice > 0) {
        const historicalPsValues = historicalPrices
          .filter(p => p.closePrice > 0)
          .map(p => currentPs * p.closePrice / currentPrice);
        const rank = historicalPsValues.filter(v => v < currentPs).length;
        const psPercentile = Math.round((rank / historicalPsValues.length) * 10000) / 100;
        const psZone = psPercentile < 30 ? 'low' : psPercentile < 70 ? 'fair' : 'high';
        const psZoneCn = psZone === 'low' ? '低估' : psZone === 'fair' ? '合理' : '高估';
        summary += `，PS ${psPercentile}%分位（${psZoneCn}）`;
      }
    }
  }

  return summary;
}

function buildNewsTitles(context: Awaited<ReturnType<typeof buildAnalysisContext>>): string {
  if (!context.newsItems || context.newsItems.length === 0) return '';
  return context.newsItems.map((n) => n.title).join('；');
}

// --- Create message on completion ---

function createDeepReportMessage(
  userId: number,
  stockCode: string,
  stockName: string,
  reportId: number,
  conclusion: string,
  db: Database.Database
): void {
  const now = new Date().toISOString();
  const detail = JSON.stringify({ reportId, conclusion });
  db.prepare(
    `INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read, created_at)
     VALUES (?, 'deep_report', ?, ?, '深度分析报告已完成', ?, 0, ?)`
  ).run(userId, stockCode, stockName, detail, now);
}

// --- Core generation logic ---

async function generateReportContent(
  reportId: number,
  stockCode: string,
  userId: number,
  db: Database.Database
): Promise<DeepReport> {
  try {
    // Build analysis context
    const context = await buildAnalysisContext(stockCode, userId, db);

    const indicatorsSummary = buildIndicatorsSummary(context);
    const newsTitles = buildNewsTitles(context);
    const today = new Date().toISOString().split('T')[0];

    // 获取核心财务数据（多接口互补）
    const financialMetrics = await fetchFinancialData(stockCode, db);
    const financialDataStr = buildFinancialDataString(financialMetrics);

    // 获取估值分位（含PS分位计算）
    const valuationData = getValuationFromDb(stockCode, db);
    const historicalPrices = getHistoricalPrices(stockCode, db);
    const valuationSummary = buildValuationSummary(valuationData, financialMetrics, historicalPrices);

    const prompt = buildDeepAnalysisPrompt(
      context.stockName,
      stockCode,
      context.marketData.price,
      indicatorsSummary,
      valuationSummary,
      newsTitles,
      today,
      financialDataStr
    );

    // Call AI
    const provider = getAIProvider();
    const aiResponse = await provider.chat(
      [{ role: 'user', content: prompt }],
      '你是A股分析师。极简输出，只说关键数据和结论。用"参考方案"不用"建议/推荐"。'
    );

    // Parse response
    const parsed = parseDeepAnalysisResponse(aiResponse);
    const modelName = provider.getModelName();

    // 从结论文本中提取置信度，如"置信度78%"
    const confMatch = parsed.conclusion.match(/置信度\s*[:：]?\s*(\d+)\s*%/);
    const confidence = confMatch ? parseInt(confMatch[1], 10) : null;

    // Update report to completed
    db.prepare(
      `UPDATE deep_reports
       SET conclusion = ?, fundamentals = ?, financials = ?, valuation = ?,
           strategy = ?, ai_model = ?, confidence = ?, data_cutoff_date = ?, status = 'completed'
       WHERE id = ?`
    ).run(
      parsed.conclusion,
      parsed.fundamentals,
      parsed.financials,
      parsed.valuation,
      parsed.strategy,
      modelName,
      confidence,
      today,
      reportId
    );

    // Create message
    createDeepReportMessage(userId, stockCode, context.stockName, reportId, parsed.conclusion, db);

    // Return completed report
    const row = db.prepare('SELECT * FROM deep_reports WHERE id = ?').get(reportId) as DeepReportRow;
    return toDeepReport(row);
  } catch (error) {
    // Mark as failed
    db.prepare("UPDATE deep_reports SET status = 'failed' WHERE id = ?").run(reportId);
    const row = db.prepare('SELECT * FROM deep_reports WHERE id = ?').get(reportId) as DeepReportRow;
    return toDeepReport(row);
  }
}

// --- Public API ---

/**
 * Generate a deep analysis report (synchronous, waits for completion).
 * Checks 24h cache first; if cached, returns it (shared across users).
 */
export async function generateDeepReport(
  stockCode: string,
  userId: number,
  db?: Database.Database
): Promise<DeepReport> {
  const database = db || getDatabase();

  // Check 24h cache
  const cached = findCachedReport(stockCode, database);
  if (cached) return cached;

  // Get stock name for the generating row
  let stockName = stockCode;
  try {
    const quote = await getQuote(stockCode, database);
    stockName = quote.stockName;
  } catch {
    // Use stockCode as fallback name
  }

  // Create generating row
  const now = new Date().toISOString();
  const today = now.split('T')[0];
  const result = database.prepare(
    `INSERT INTO deep_reports (user_id, stock_code, stock_name, conclusion, fundamentals, financials, valuation, strategy, ai_model, data_cutoff_date, status, created_at)
     VALUES (?, ?, ?, '', '', '', '', '', '', ?, 'generating', ?)`
  ).run(userId, stockCode, stockName, today, now);

  const reportId = Number(result.lastInsertRowid);

  // Generate content
  return generateReportContent(reportId, stockCode, userId, database);
}

/**
 * Start deep report generation asynchronously.
 * Returns immediately with reportId and 'generating' status.
 * Generation continues in background.
 */
export async function generateDeepReportAsync(
  stockCode: string,
  userId: number,
  db?: Database.Database
): Promise<{ reportId: number; status: 'generating' }> {
  const database = db || getDatabase();

  // Check 24h cache — if cached, still return async-style
  const cached = findCachedReport(stockCode, database);
  if (cached) {
    return { reportId: cached.id, status: 'generating' };
  }

  // Get stock name
  let stockName = stockCode;
  try {
    const quote = await getQuote(stockCode, database);
    stockName = quote.stockName;
  } catch {
    // fallback
  }

  // Create generating row
  const now = new Date().toISOString();
  const today = now.split('T')[0];
  const result = database.prepare(
    `INSERT INTO deep_reports (user_id, stock_code, stock_name, conclusion, fundamentals, financials, valuation, strategy, ai_model, data_cutoff_date, status, created_at)
     VALUES (?, ?, ?, '', '', '', '', '', '', ?, 'generating', ?)`
  ).run(userId, stockCode, stockName, today, now);

  const reportId = Number(result.lastInsertRowid);

  // Fire-and-forget with error handling
  generateReportContent(reportId, stockCode, userId, database).catch(() => {
    // Error already handled inside generateReportContent (marks as failed)
  });

  return { reportId, status: 'generating' };
}

/**
 * Get a specific report by ID (scoped to the owning user).
 */
export function getDeepReport(
  reportId: number,
  userId: number,
  db?: Database.Database
): DeepReport | null {
  const database = db || getDatabase();
  const row = database
    .prepare('SELECT * FROM deep_reports WHERE id = ? AND user_id = ?')
    .get(reportId, userId) as DeepReportRow | undefined;
  return row ? toDeepReport(row) : null;
}

/**
 * Get report history for a user, optionally filtered by stockCode.
 */
export function getDeepReportHistory(
  stockCode: string | undefined,
  page: number,
  limit: number,
  userId: number,
  db?: Database.Database
): { reports: DeepReport[]; total: number; hasMore: boolean } {
  const database = db || getDatabase();

  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const offset = (safePage - 1) * safeLimit;

  let countSql = 'SELECT COUNT(*) as total FROM deep_reports WHERE user_id = ?';
  let querySql = 'SELECT * FROM deep_reports WHERE user_id = ?';
  const params: (string | number)[] = [userId];

  if (stockCode) {
    countSql += ' AND stock_code = ?';
    querySql += ' AND stock_code = ?';
    params.push(stockCode);
  }

  querySql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

  const { total } = database.prepare(countSql).get(...params) as { total: number };
  const rows = database.prepare(querySql).all(...params, safeLimit, offset) as DeepReportRow[];

  return {
    reports: rows.map(toDeepReport),
    total,
    hasMore: offset + rows.length < total,
  };
}
