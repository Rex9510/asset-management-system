/**
 * 估值分位展示完整性属性测试
 * Task 5.7
 */
import * as fc from 'fast-check';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ValuationTag from './ValuationTag';
import * as valuationApi from '../api/valuation';
import { ValuationData } from '../api/valuation';

jest.mock('../api/valuation');

const mockGetValuation = valuationApi.getValuation as jest.MockedFunction<typeof valuationApi.getValuation>;

function makeValuation(
  pePercentile: number,
  pbPercentile: number,
  peZone: 'low' | 'fair' | 'high',
  pbZone: 'low' | 'fair' | 'high',
  dataYears: number
): ValuationData {
  return {
    stockCode: '600000',
    peValue: 10,
    pbValue: 1.5,
    pePercentile,
    pbPercentile,
    peZone,
    pbZone,
    dataYears,
    source: 'tencent',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

const zoneLabel: Record<string, string> = { low: '低估', fair: '合理', high: '高估' };

// Feature: ai-investment-assistant-phase2, Property 4: 估值分位展示完整性
// 验证需求：1.1, 1.7
test('渲染结果包含PE分位、PB分位、区间标签、数据年限', async () => {
  const testCases = fc.sample(
    fc.record({
      pePercentile: fc.integer({ min: 0, max: 100 }),
      pbPercentile: fc.integer({ min: 0, max: 100 }),
      peZone: fc.constantFrom('low' as const, 'fair' as const, 'high' as const),
      pbZone: fc.constantFrom('low' as const, 'fair' as const, 'high' as const),
      dataYears: fc.integer({ min: 1, max: 15 }),
    }),
    20
  );

  for (const tc of testCases) {
    const data = makeValuation(tc.pePercentile, tc.pbPercentile, tc.peZone, tc.pbZone, tc.dataYears);
    mockGetValuation.mockResolvedValue(data);

    const { unmount } = render(<ValuationTag stockCode="600000" />);

    await waitFor(() => {
      // PE tag with percentile and zone label
      const peText = `PE ${Math.round(tc.pePercentile)}% ${zoneLabel[tc.peZone]}`;
      expect(screen.getByText(peText)).toBeInTheDocument();

      // PB tag with percentile and zone label
      const pbText = `PB ${Math.round(tc.pbPercentile)}% ${zoneLabel[tc.pbZone]}`;
      expect(screen.getByText(pbText)).toBeInTheDocument();
    });

    // Data years annotation shown when < 10
    if (tc.dataYears < 10) {
      expect(screen.getByText(`${tc.dataYears}年数据`)).toBeInTheDocument();
    } else {
      expect(screen.queryByText(/年数据/)).not.toBeInTheDocument();
    }

    unmount();
    jest.clearAllMocks();
  }
});
