import { isTradingDay, isTradingDayIsoDate, isTradingHours, _resetHolidayCache } from './tradingDayGuard';

beforeEach(() => {
  _resetHolidayCache();
});

describe('isTradingDay', () => {
  test('weekday that is not a holiday returns true', () => {
    // 2025-03-10 is Monday
    expect(isTradingDay(new Date('2025-03-10T10:00:00'))).toBe(true);
  });

  test('Saturday returns false', () => {
    // 2025-03-08 is Saturday
    expect(isTradingDay(new Date('2025-03-08T10:00:00'))).toBe(false);
  });

  test('Sunday returns false', () => {
    // 2025-03-09 is Sunday
    expect(isTradingDay(new Date('2025-03-09T10:00:00'))).toBe(false);
  });

  test('statutory holiday (New Year) returns false', () => {
    // 2025-01-01 is Wednesday, New Year holiday
    expect(isTradingDay(new Date('2025-01-01T10:00:00'))).toBe(false);
  });

  test('Spring Festival holiday returns false', () => {
    // 2025-01-29 is Wednesday, Spring Festival
    expect(isTradingDay(new Date('2025-01-29T10:00:00'))).toBe(false);
  });

  test('National Day holiday returns false', () => {
    // 2025-10-01 is Wednesday
    expect(isTradingDay(new Date('2025-10-01T10:00:00'))).toBe(false);
  });

  test('makeup trading day (weekend but working) returns true', () => {
    // 2025-01-26 is Sunday, but a makeup trading day for Spring Festival
    expect(isTradingDay(new Date('2025-01-26T10:00:00'))).toBe(true);
  });

  test('another makeup trading day returns true', () => {
    // 2025-02-08 is Saturday, makeup trading day
    expect(isTradingDay(new Date('2025-02-08T10:00:00'))).toBe(true);
  });

  test('2026 holiday returns false', () => {
    // 2026-01-01 is Thursday, New Year
    expect(isTradingDay(new Date('2026-01-01T10:00:00'))).toBe(false);
  });

  test('2026 makeup trading day returns true', () => {
    // 2026-02-14 is Saturday, makeup trading day
    expect(isTradingDay(new Date('2026-02-14T10:00:00'))).toBe(true);
  });

  test('regular weekday in 2026 returns true', () => {
    // 2026-03-02 is Monday
    expect(isTradingDay(new Date('2026-03-02T10:00:00'))).toBe(true);
  });

  test('isTradingDayIsoDate matches Date form (weekday)', () => {
    expect(isTradingDayIsoDate('2025-03-10')).toBe(true);
  });

  test('isTradingDayIsoDate rejects Sunday', () => {
    expect(isTradingDayIsoDate('2025-03-09')).toBe(false);
  });

  test('isTradingDayIsoDate rejects invalid format', () => {
    expect(isTradingDayIsoDate('2025-3-9')).toBe(false);
    expect(isTradingDayIsoDate('')).toBe(false);
  });

  test('fallback: year not in holiday table uses weekend-only check', () => {
    // 2030-03-11 is Monday, no holiday data for 2030
    expect(isTradingDay(new Date('2030-03-11T10:00:00'))).toBe(true);
    // 2030-03-09 is Saturday
    expect(isTradingDay(new Date('2030-03-09T10:00:00'))).toBe(false);
  });
});

describe('isTradingHours', () => {
  // Use a known trading day: 2025-03-10 Monday
  const tradingDay = '2025-03-10';

  test('9:30 is within morning session', () => {
    expect(isTradingHours(new Date(`${tradingDay}T09:30:00`))).toBe(true);
  });

  test('10:00 is within morning session', () => {
    expect(isTradingHours(new Date(`${tradingDay}T10:00:00`))).toBe(true);
  });

  test('11:29 is within morning session', () => {
    expect(isTradingHours(new Date(`${tradingDay}T11:29:00`))).toBe(true);
  });

  test('11:30 is lunch break (not trading)', () => {
    expect(isTradingHours(new Date(`${tradingDay}T11:30:00`))).toBe(false);
  });

  test('12:00 is lunch break', () => {
    expect(isTradingHours(new Date(`${tradingDay}T12:00:00`))).toBe(false);
  });

  test('12:59 is lunch break', () => {
    expect(isTradingHours(new Date(`${tradingDay}T12:59:00`))).toBe(false);
  });

  test('13:00 is within afternoon session', () => {
    expect(isTradingHours(new Date(`${tradingDay}T13:00:00`))).toBe(true);
  });

  test('14:30 is within afternoon session', () => {
    expect(isTradingHours(new Date(`${tradingDay}T14:30:00`))).toBe(true);
  });

  test('14:59 is within afternoon session', () => {
    expect(isTradingHours(new Date(`${tradingDay}T14:59:00`))).toBe(true);
  });

  test('15:00 is after market close', () => {
    expect(isTradingHours(new Date(`${tradingDay}T15:00:00`))).toBe(false);
  });

  test('9:00 is before market open', () => {
    expect(isTradingHours(new Date(`${tradingDay}T09:00:00`))).toBe(false);
  });

  test('9:29 is before market open', () => {
    expect(isTradingHours(new Date(`${tradingDay}T09:29:00`))).toBe(false);
  });

  test('16:00 is after market close', () => {
    expect(isTradingHours(new Date(`${tradingDay}T16:00:00`))).toBe(false);
  });

  test('returns false on weekends even during trading hours', () => {
    // 2025-03-08 is Saturday
    expect(isTradingHours(new Date('2025-03-08T10:00:00'))).toBe(false);
  });

  test('returns false on holidays even during trading hours', () => {
    // 2025-01-01 is a holiday
    expect(isTradingHours(new Date('2025-01-01T10:00:00'))).toBe(false);
  });

  test('returns true on makeup trading day during trading hours', () => {
    // 2025-01-26 is Sunday but makeup trading day
    expect(isTradingHours(new Date('2025-01-26T10:00:00'))).toBe(true);
  });

  test('returns false on makeup trading day outside trading hours', () => {
    // 2025-01-26 is makeup day but 8:00 is before market
    expect(isTradingHours(new Date('2025-01-26T08:00:00'))).toBe(false);
  });
});
