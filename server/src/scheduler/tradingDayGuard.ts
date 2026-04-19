/**
 * A股交易日判断守卫
 *
 * 判断指定日期是否为A股交易日，以及是否在交易时间内。
 * 所有收盘后定时任务和盘中定时分析在执行前必须先通过此守卫。
 *
 * 策略在 holidays.json 基础上叠加「行情侧」交易日：见 trading_calendar_sdk（上证日K同步）。
 */

import * as path from 'path';
import * as fs from 'fs';
import type Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';

// --- Types ---

interface HolidayData {
  holidays: Record<string, string[]>;
  makeupTradingDays: Record<string, string[]>;
}

// --- Holiday data loading ---

let holidayData: HolidayData | null = null;

function loadHolidayData(): HolidayData | null {
  if (holidayData) return holidayData;

  try {
    const filePath = path.join(__dirname, 'holidays.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as HolidayData;
    holidayData = parsed;
    return parsed;
  } catch {
    // Fallback: holiday table missing, will use weekend-only check
    return null;
  }
}

/** Exposed for testing: reset cached holiday data */
export function _resetHolidayCache(): void {
  holidayData = null;
}

/** 行情日历缓存行数达到此阈值时，才在「历史区间内缺 K」的工作日上判定为休市（避免数据不完整误判） */
const SDK_NEGATIVE_INFERENCE_MIN_ROWS = 120;

let sdkOverlayLoaded = false;
let sdkTradingDates = new Set<string>();
let sdkRangeMin: string | null = null;
let sdkRangeMax: string | null = null;

function ensureSdkOverlay(): void {
  if (sdkOverlayLoaded) return;
  reloadTradingCalendarSdkFromDb();
}

/** 从 DB 重载行情侧交易日集合（同步任务或测试后调用） */
export function reloadTradingCalendarSdkFromDb(db?: Database.Database): void {
  sdkOverlayLoaded = true;
  sdkTradingDates = new Set();
  sdkRangeMin = null;
  sdkRangeMax = null;
  try {
    const database = db ?? getDatabase();
    const agg = database
      .prepare('SELECT MIN(trade_date) as mn, MAX(trade_date) as mx, COUNT(*) as cnt FROM trading_calendar_sdk')
      .get() as { mn: string | null; mx: string | null; cnt: number };
    if (!agg.cnt) return;
    const rows = database.prepare('SELECT trade_date FROM trading_calendar_sdk').all() as { trade_date: string }[];
    for (const r of rows) sdkTradingDates.add(r.trade_date);
    sdkRangeMin = agg.mn;
    sdkRangeMax = agg.mx;
  } catch {
    // 表不存在或查询失败：保持空集，回退为仅节假日表逻辑
  }
}

/** 测试用：下次 isTradingDay 重新读库 */
export function _resetTradingCalendarSdkCacheForTests(): void {
  sdkOverlayLoaded = false;
  sdkTradingDates = new Set();
  sdkRangeMin = null;
  sdkRangeMax = null;
}

// --- Helper: format date as YYYY-MM-DD ---

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return `${y}-${m}-${d}`;
}

// --- Core functions ---

/**
 * 判断指定日期是否为A股交易日
 *
 * 策略：
 * 1. 检查是否为调休补班日（周末但需上班）→ 返回 true
 * 2. 排除周六日
 * 3. 排除法定节假日（从 holidays.json 读取）
 * 4. 行情侧：trading_calendar_sdk 中有上证日 K 的日期 → true（已开市）
 * 5. 历史补判：缓存足够完整时，区间内工作日且无 K → false（休市，多为节假日表未收录的休市）
 * 6. 兜底：节假日表缺失时回退到仅判断周六日 + 行情叠加
 */
/**
 * 日历日期 `YYYY-MM-DD` 是否为 A 股交易日（与 isTradingDay 相同节假日/补班表）。
 * 使用当日正午解析，避免时区边界把日历日推偏。
 */
export function isTradingDayIsoDate(isoDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  return isTradingDay(new Date(`${isoDate}T12:00:00`));
}

export function isTradingDay(date: Date): boolean {
  ensureSdkOverlay();
  const data = loadHolidayData();
  const dateStr = formatDate(date);
  const year = String(date.getFullYear());
  const dayOfWeek = date.getDay(); // 0=Sunday, 6=Saturday

  const applySdkOverlay = (): boolean => {
    if (sdkTradingDates.has(dateStr)) {
      return true;
    }
    const todayStr = formatDate(new Date());
    if (
      sdkTradingDates.size >= SDK_NEGATIVE_INFERENCE_MIN_ROWS &&
      sdkRangeMin &&
      sdkRangeMax &&
      dateStr >= sdkRangeMin &&
      dateStr <= sdkRangeMax &&
      dateStr < todayStr &&
      dayOfWeek >= 1 &&
      dayOfWeek <= 5
    ) {
      return false;
    }
    return true;
  };

  if (data) {
    // Check makeup trading days first (weekends that are working days)
    const makeupDays = data.makeupTradingDays[year] || [];
    if (makeupDays.includes(dateStr)) {
      return true;
    }

    // Exclude weekends (not makeup days)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return false;
    }

    // Exclude statutory holidays
    const holidays = data.holidays[year] || [];
    if (holidays.includes(dateStr)) {
      return false;
    }

    return applySdkOverlay();
  }

  // Fallback: no holiday data, weekend-only check + 行情叠加
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }
  return applySdkOverlay();
}

/**
 * 判断指定时间是否在A股交易时间内
 *
 * A股交易时间：9:30-11:30, 13:00-15:00
 * 午休 11:30-13:00 返回 false
 *
 * 仅在交易日才可能返回 true
 */
export function isTradingHours(date: Date): boolean {
  if (!isTradingDay(date)) {
    return false;
  }

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // Morning session: 9:30 (570) - 11:30 (690)
  const morningStart = 9 * 60 + 30;  // 570
  const morningEnd = 11 * 60 + 30;   // 690

  // Afternoon session: 13:00 (780) - 15:00 (900)
  const afternoonStart = 13 * 60;     // 780
  const afternoonEnd = 15 * 60;       // 900

  if (timeInMinutes >= morningStart && timeInMinutes < morningEnd) {
    return true;
  }

  if (timeInMinutes >= afternoonStart && timeInMinutes < afternoonEnd) {
    return true;
  }

  return false;
}
