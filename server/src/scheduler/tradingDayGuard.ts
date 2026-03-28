/**
 * A股交易日判断守卫
 *
 * 判断指定日期是否为A股交易日，以及是否在交易时间内。
 * 所有收盘后定时任务和盘中定时分析在执行前必须先通过此守卫。
 */

import * as path from 'path';
import * as fs from 'fs';

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

// --- Helper: format date as YYYY-MM-DD ---

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
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
 * 4. 兜底：节假日表缺失时回退到仅判断周六日
 */
export function isTradingDay(date: Date): boolean {
  const data = loadHolidayData();
  const dateStr = formatDate(date);
  const year = String(date.getFullYear());
  const dayOfWeek = date.getDay(); // 0=Sunday, 6=Saturday

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

    // Weekday and not a holiday → trading day
    return true;
  }

  // Fallback: no holiday data, weekend-only check
  return dayOfWeek !== 0 && dayOfWeek !== 6;
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
