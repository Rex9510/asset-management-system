import {
  buildSingleQuarterSeriesFromCpd,
  buildTtmNoticeEvents,
  buildHistoricalPePbFromFundamentals,
  type CpdApiRow,
} from './fundamentalPeService';

describe('fundamentalPeService', () => {
  it('buildSingleQuarterSeriesFromCpd splits cumulative BASIC_EPS by fiscal year', () => {
    const rows: CpdApiRow[] = [
      { REPORTDATE: '2024-03-31', BASIC_EPS: 10, BPS: 100, QDATE: '2024Q1', NOTICE_DATE: '2024-04-05' },
      { REPORTDATE: '2024-06-30', BASIC_EPS: 22, BPS: 110, QDATE: '2024Q2', NOTICE_DATE: '2024-07-05' },
      { REPORTDATE: '2024-09-30', BASIC_EPS: 36, BPS: 115, QDATE: '2024Q3', NOTICE_DATE: '2024-10-05' },
      { REPORTDATE: '2024-12-31', BASIC_EPS: 55, BPS: 120, QDATE: '2024Q4', NOTICE_DATE: '2025-03-10' },
      { REPORTDATE: '2025-03-31', BASIC_EPS: 12, BPS: 122, QDATE: '2025Q1', NOTICE_DATE: '2025-04-05' },
      { REPORTDATE: '2025-06-30', BASIC_EPS: 25, BPS: 125, QDATE: '2025Q2', NOTICE_DATE: '2025-07-05' },
      { REPORTDATE: '2025-09-30', BASIC_EPS: 40, BPS: 128, QDATE: '2025Q3', NOTICE_DATE: '2025-10-05' },
      { REPORTDATE: '2025-12-31', BASIC_EPS: 60, BPS: 130, QDATE: '2025Q4', NOTICE_DATE: '2026-03-10' },
    ];
    const singles = buildSingleQuarterSeriesFromCpd(rows);
    expect(singles.find((s) => s.reportDate.startsWith('2024-06'))?.singleEps).toBeCloseTo(12, 5);
    expect(singles.find((s) => s.reportDate.startsWith('2024-09'))?.singleEps).toBeCloseTo(14, 5);
    expect(singles.find((s) => s.reportDate.startsWith('2024-12'))?.singleEps).toBeCloseTo(19, 5);
  });

  it('buildTtmNoticeEvents emits TTM after four single quarters', () => {
    const rows: CpdApiRow[] = [
      { REPORTDATE: '2023-03-31', BASIC_EPS: 5, BPS: 80, QDATE: '2023Q1', NOTICE_DATE: '2023-04-01' },
      { REPORTDATE: '2023-06-30', BASIC_EPS: 11, BPS: 82, QDATE: '2023Q2', NOTICE_DATE: '2023-07-01' },
      { REPORTDATE: '2023-09-30', BASIC_EPS: 18, BPS: 84, QDATE: '2023Q3', NOTICE_DATE: '2023-10-01' },
      { REPORTDATE: '2023-12-31', BASIC_EPS: 28, BPS: 86, QDATE: '2023Q4', NOTICE_DATE: '2024-03-01' },
      { REPORTDATE: '2024-03-31', BASIC_EPS: 6, BPS: 88, QDATE: '2024Q1', NOTICE_DATE: '2024-04-01' },
      { REPORTDATE: '2024-06-30', BASIC_EPS: 13, BPS: 90, QDATE: '2024Q2', NOTICE_DATE: '2024-07-01' },
      { REPORTDATE: '2024-09-30', BASIC_EPS: 21, BPS: 92, QDATE: '2024Q3', NOTICE_DATE: '2024-10-01' },
      { REPORTDATE: '2024-12-31', BASIC_EPS: 32, BPS: 94, QDATE: '2024Q4', NOTICE_DATE: '2025-03-01' },
    ];
    const singles = buildSingleQuarterSeriesFromCpd(rows);
    const events = buildTtmNoticeEvents(singles);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    expect(last.ttmEps).toBeGreaterThan(0);
    expect(last.bps).not.toBeNull();
  });

  it('buildHistoricalPePbFromFundamentals aligns prices with notice dates', () => {
    const events = [
      { effectiveDay: '2020-01-01', ttmEps: 2, bps: 10 },
      { effectiveDay: '2025-01-01', ttmEps: 4, bps: 20 },
    ];
    const prices = [
      { tradeDate: '2023-06-01', closePrice: 20 },
      { tradeDate: '2024-06-01', closePrice: 40 },
      { tradeDate: '2025-06-01', closePrice: 80 },
    ];
    const { peSeries, pbSeries } = buildHistoricalPePbFromFundamentals(prices, events, null);
    expect(peSeries.length).toBe(3);
    expect(peSeries[0]).toBeCloseTo(20 / 2, 5);
    expect(peSeries[1]).toBeCloseTo(40 / 2, 5);
    expect(peSeries[2]).toBeCloseTo(80 / 4, 5);
    expect(pbSeries[2]).toBeCloseTo(80 / 20, 5);
  });
});
