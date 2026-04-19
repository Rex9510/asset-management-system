/**
 * 交易日守卫属性测试
 * Task 1.4
 */
import * as fc from 'fast-check';
import { isTradingDay, isTradingHours, _resetHolidayCache, _resetTradingCalendarSdkCacheForTests } from './tradingDayGuard';

beforeEach(() => {
  _resetHolidayCache();
  _resetTradingCalendarSdkCacheForTests();
});

// Feature: ai-investment-assistant-phase2, Property: 交易日守卫 — 周六日判断
test('周六日一定返回 false（非调休补班日年份）', () => {
  // 验证需求：9.4
  fc.assert(
    fc.property(
      // 生成2030年的日期（无调休补班数据）
      fc.integer({ min: 0, max: 364 }),
      (dayOfYear) => {
        const date = new Date(2030, 0, 1 + dayOfYear);
        const dow = date.getDay();
        if (dow === 0 || dow === 6) {
          return isTradingDay(date) === false;
        }
        return true; // weekdays: no constraint in this property
      }
    ),
    { numRuns: 200 }
  );
});

// Feature: ai-investment-assistant-phase2, Property: 交易日守卫 — 交易时间排除午休
test('交易时间判断排除午休 11:30-13:00', () => {
  // 验证需求：9.4
  fc.assert(
    fc.property(
      // 生成午休时间段的分钟数 (11:30=690 到 12:59=779)
      fc.integer({ min: 690, max: 779 }),
      (totalMinutes) => {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        // Use a known trading day: 2025-03-10 Monday
        const date = new Date(2025, 2, 10, hours, minutes, 0);
        return isTradingHours(date) === false;
      }
    ),
    { numRuns: 100 }
  );
});
