/**
 * 基于财报披露的基本面估值序列（PE / PB 分位）
 *
 * 数据源：东方财富 datacenter RPT_LICO_FN_CPD（主要财务指标：累计 BASIC_EPS、每股净资产 BPS）
 * - 将各期「累计每股收益」拆解为单季 EPS，再滚动 4 个单季得到 TTM EPS
 * - 历史 PE = 当日收盘价 / 当时适用的 TTM EPS（按 NOTICE_DATE 起生效，缺失则用 REPORTDATE）
 * - 历史 PB = 当日收盘价 / 当时适用的最新 BPS（同上）
 */
import axios from 'axios';

export interface CpdApiRow {
  REPORTDATE: string;
  BASIC_EPS: number | string | null;
  BPS?: number | string | null;
  QDATE?: string | null;
  NOTICE_DATE?: string | null;
}

export interface SingleQuarterEps {
  reportDate: string;
  noticeDay: string;
  fiscalYear: string;
  singleEps: number;
  bps: number | null;
}

export interface TtmNoticeEvent {
  /** YYYY-MM-DD：公告日优先，否则报告期末 */
  effectiveDay: string;
  ttmEps: number;
  bps: number | null;
}

export interface FundamentalPercentiles {
  pePercentile: number;
  /** 若样本不足则为 null，由调用方回退到价格缩放 PB */
  pbPercentile: number | null;
  pbFromFundamental: boolean;
  /** 有有效 TTM 的交易日样本数 */
  sampleCount: number;
  /** 首条有效 TTM 生效日至最后行情日的年数（用于展示「基本面序列覆盖」） */
  fundamentalSpanYears: number;
}

function toNum(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return !isNaN(n) && n > 0 ? n : null;
}

function toDayPart(s: string | null | undefined): string {
  if (!s) return '';
  const d = String(s).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

/**
 * 拉取东财主要财务指标（分页，按报告期升序）
 */
export async function fetchCpdRowsFromEastMoney(stockCode: string): Promise<CpdApiRow[]> {
  const filter = encodeURIComponent(`(SECURITY_CODE="${stockCode}")`);
  const all: CpdApiRow[] = [];
  let page = 1;
  const pageSize = 200;
  const columns = encodeURIComponent(
    'SECURITY_CODE,REPORTDATE,BASIC_EPS,BPS,QDATE,NOTICE_DATE'
  );

  for (;;) {
    const url =
      `https://datacenter-web.eastmoney.com/api/data/v1/get?` +
      `sortColumns=REPORTDATE&sortTypes=1&pageSize=${pageSize}&pageNumber=${page}&` +
      `reportName=RPT_LICO_FN_CPD&columns=${columns}&filter=${filter}`;

    const resp = await axios.get(url, {
      timeout: 15000,
      headers: { Referer: 'https://emweb.securities.eastmoney.com/' },
    });

    const body = resp.data as {
      success?: boolean;
      result?: { data?: CpdApiRow[]; pages?: number };
    };
    if (!body?.success || !body.result?.data?.length) break;

    all.push(...body.result.data);
    const pages = body.result.pages ?? 1;
    if (page >= pages) break;
    page++;
  }

  return all;
}

function quarterOrderFromQdate(qdate: string | null | undefined): number | null {
  if (!qdate) return null;
  const m = String(qdate).match(/Q(\d)/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * 将 CPD 行转为单季 EPS：同一财报年（QDATE 年）内按报告期顺序，用「本期累计 − 上期累计」。
 * 仅使用带 QDATE 的行，避免跨期口径错误。
 */
export function buildSingleQuarterSeriesFromCpd(rows: CpdApiRow[]): SingleQuarterEps[] {
  const sorted = [...rows]
    .filter((r) => toNum(r.BASIC_EPS) != null && r.QDATE && String(r.QDATE).length >= 6)
    .sort((a, b) => {
      const da = toDayPart(a.REPORTDATE) || a.REPORTDATE;
      const db = toDayPart(b.REPORTDATE) || b.REPORTDATE;
      return da.localeCompare(db);
    });

  const lastCumByFy = new Map<string, number>();
  const singles: SingleQuarterEps[] = [];

  for (const row of sorted) {
    const cum = toNum(row.BASIC_EPS);
    if (cum == null) continue;

    const fy = String(row.QDATE).slice(0, 4);
    if (!/^\d{4}$/.test(fy)) continue;

    const qo = quarterOrderFromQdate(row.QDATE);
    if (qo == null) continue;

    const prev = lastCumByFy.get(fy);
    if (prev == null && qo > 1) {
      continue;
    }

    const single = prev == null ? cum : cum - prev;
    lastCumByFy.set(fy, cum);

    if (!(single > 0)) continue;

    const noticeRaw = toDayPart(row.NOTICE_DATE || undefined);
    const reportDay = toDayPart(row.REPORTDATE) || row.REPORTDATE.slice(0, 10);
    const noticeDay = noticeRaw || reportDay;

    const bps = toNum(row.BPS ?? null);

    singles.push({
      reportDate: reportDay,
      noticeDay,
      fiscalYear: fy,
      singleEps: single,
      bps,
    });
  }

  return singles;
}

/**
 * 对单季序列滚动 4 季得到 TTM，并在每条记录的公告日挂上 TTM 与 BPS。
 */
export function buildTtmNoticeEvents(singles: SingleQuarterEps[]): TtmNoticeEvent[] {
  const sorted = [...singles].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  const q: number[] = [];
  const events: TtmNoticeEvent[] = [];
  let lastBps: number | null = null;

  for (const s of sorted) {
    if (s.bps != null && s.bps > 0) lastBps = s.bps;

    q.push(s.singleEps);
    if (q.length > 4) q.shift();
    if (q.length < 4) continue;

    const ttmEps = q.reduce((x, y) => x + y, 0);
    if (!(ttmEps > 0)) continue;

    events.push({
      effectiveDay: s.noticeDay,
      ttmEps,
      bps: lastBps,
    });
  }

  return events;
}

function mergeEventsByEffectiveDay(events: TtmNoticeEvent[]): TtmNoticeEvent[] {
  const sorted = [...events].sort((a, b) => a.effectiveDay.localeCompare(b.effectiveDay));
  const out: TtmNoticeEvent[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && last.effectiveDay === e.effectiveDay) {
      out[out.length - 1] = { ...e };
    } else {
      out.push({ ...e });
    }
  }
  return out;
}

/**
 * 对每个交易日，取「生效日 ≤ 交易日」的最后一条 TTM/BPS 事件，计算 PE、PB 序列。
 */
export function buildHistoricalPePbFromFundamentals(
  historicalPrices: { tradeDate: string; closePrice: number }[],
  events: TtmNoticeEvent[],
  lastCloseOverride: number | null
): { peSeries: number[]; pbSeries: number[]; lastPe: number | null; lastPb: number | null } {
  const merged = mergeEventsByEffectiveDay(events);
  if (merged.length === 0 || historicalPrices.length === 0) {
    return { peSeries: [], pbSeries: [], lastPe: null, lastPb: null };
  }

  const peSeries: number[] = [];
  const pbSeries: number[] = [];
  let j = 0;
  let cur: TtmNoticeEvent | null = null;
  let curBps: number | null = null;

  const n = historicalPrices.length;

  for (let i = 0; i < n; i++) {
    const p = historicalPrices[i];
    const tradeDay = toDayPart(p.tradeDate) || p.tradeDate.slice(0, 10);
    const close =
      i === n - 1 && lastCloseOverride != null && lastCloseOverride > 0
        ? lastCloseOverride
        : p.closePrice;

    while (j < merged.length && merged[j].effectiveDay <= tradeDay) {
      cur = merged[j];
      if (merged[j].bps != null && merged[j].bps! > 0) {
        curBps = merged[j].bps!;
      }
      j++;
    }

    if (cur && cur.ttmEps > 0 && close > 0) {
      peSeries.push(close / cur.ttmEps);
    }
    if (curBps != null && curBps > 0 && close > 0) {
      pbSeries.push(close / curBps);
    }
  }

  const lastPe = peSeries.length > 0 ? peSeries[peSeries.length - 1] : null;
  const lastPb = pbSeries.length > 0 ? pbSeries[pbSeries.length - 1] : null;

  return { peSeries, pbSeries, lastPe, lastPb };
}

export function fundamentalSpanYears(
  events: TtmNoticeEvent[],
  historicalPrices: { tradeDate: string }[]
): number {
  if (events.length === 0 || historicalPrices.length < 2) return 0;
  const firstEff = events[0].effectiveDay;
  const lastTrade =
    toDayPart(historicalPrices[historicalPrices.length - 1].tradeDate) ||
    historicalPrices[historicalPrices.length - 1].tradeDate.slice(0, 10);
  const a = new Date(`${firstEff}T12:00:00`).getTime();
  const b = new Date(`${lastTrade}T12:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round(((b - a) / (365.25 * 86400e3)) * 10) / 10;
}

const MIN_FUNDAMENTAL_SAMPLES = 120;
const MAX_PE_FOR_SAMPLE = 800;
const MAX_PB_FOR_SAMPLE = 80;

/**
 * 用财报 TTM EPS / BPS 与本地日 K 计算 PE、PB 历史分位；数据不足或接口失败返回 null。
 */
export async function tryFundamentalPePbPercentiles(
  stockCode: string,
  historicalPrices: { tradeDate: string; closePrice: number }[],
  lastCloseOverride: number | null,
  marketPe: number | null,
  marketPb: number | null,
  calculatePercentile: (current: number, hist: number[]) => number
): Promise<FundamentalPercentiles | null> {
  if (historicalPrices.length < MIN_FUNDAMENTAL_SAMPLES) return null;

  let rows: CpdApiRow[];
  try {
    rows = await fetchCpdRowsFromEastMoney(stockCode);
  } catch {
    return null;
  }
  if (rows.length < 8) return null;

  const singles = buildSingleQuarterSeriesFromCpd(rows);
  if (singles.length < 8) return null;

  const events = buildTtmNoticeEvents(singles);
  if (events.length < 2) return null;

  const { peSeries, pbSeries, lastPe, lastPb } = buildHistoricalPePbFromFundamentals(
    historicalPrices,
    events,
    lastCloseOverride
  );

  const peHist = peSeries.filter((x) => x > 0 && x < MAX_PE_FOR_SAMPLE);
  const pbHist = pbSeries.filter((x) => x > 0 && x < MAX_PB_FOR_SAMPLE);

  if (peHist.length < MIN_FUNDAMENTAL_SAMPLES) return null;

  const currentPe = lastPe != null && lastPe > 0 ? lastPe : marketPe;
  if (currentPe == null || !(currentPe > 0)) return null;

  const pePercentile = calculatePercentile(currentPe, peHist);

  let pbPercentile: number | null = null;
  let pbFromFundamental = false;
  if (marketPb != null && marketPb > 0 && pbHist.length >= MIN_FUNDAMENTAL_SAMPLES) {
    const currentPb = lastPb != null && lastPb > 0 ? lastPb : marketPb;
    if (currentPb != null && currentPb > 0) {
      pbPercentile = calculatePercentile(currentPb, pbHist);
      pbFromFundamental = true;
    }
  }

  const span = fundamentalSpanYears(events, historicalPrices);

  return {
    pePercentile,
    pbPercentile,
    pbFromFundamental,
    sampleCount: peHist.length,
    fundamentalSpanYears: span,
  };
}
