import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ValuationTag from './ValuationTag';
import * as valuationApi from '../api/valuation';
import { ValuationData } from '../api/valuation';

jest.mock('../api/valuation');

const mockGetValuation = valuationApi.getValuation as jest.MockedFunction<typeof valuationApi.getValuation>;

function makeValuation(overrides: Partial<ValuationData> = {}): ValuationData {
  return {
    stockCode: '600000',
    peValue: 8.5,
    pbValue: 0.9,
    pePercentile: 25,
    pbPercentile: 40,
    peZone: 'low',
    pbZone: 'fair',
    dataYears: 10,
    source: 'tencent',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ValuationTag', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading placeholder initially', () => {
    mockGetValuation.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ValuationTag stockCode="600000" />);
    expect(screen.getByText('估值计算中...')).toBeInTheDocument();
  });

  it('shows error placeholder when API fails', async () => {
    mockGetValuation.mockRejectedValue(new Error('Network error'));
    render(<ValuationTag stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('估值计算中')).toBeInTheDocument();
    });
  });

  it('renders PE and PB tags with low/fair zones', async () => {
    mockGetValuation.mockResolvedValue(makeValuation());
    render(<ValuationTag stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('PE 25% 低估')).toBeInTheDocument();
      expect(screen.getByText('PB 40% 合理')).toBeInTheDocument();
    });
  });

  it('renders high zone with correct label', async () => {
    mockGetValuation.mockResolvedValue(makeValuation({
      pePercentile: 85,
      peZone: 'high',
      pbPercentile: 75,
      pbZone: 'high',
    }));
    render(<ValuationTag stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('PE 85% 高估')).toBeInTheDocument();
      expect(screen.getByText('PB 75% 高估')).toBeInTheDocument();
    });
  });

  it('shows data years annotation when < 10 years', async () => {
    mockGetValuation.mockResolvedValue(makeValuation({ dataYears: 5 }));
    render(<ValuationTag stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('5年数据')).toBeInTheDocument();
    });
  });

  it('does not show data years annotation when >= 10 years', async () => {
    mockGetValuation.mockResolvedValue(makeValuation({ dataYears: 10 }));
    render(<ValuationTag stockCode="600000" />);
    await waitFor(() => {
      expect(screen.getByText('PE 25% 低估')).toBeInTheDocument();
    });
    expect(screen.queryByText(/年数据/)).not.toBeInTheDocument();
  });

  it('applies green color for low zone tags', async () => {
    mockGetValuation.mockResolvedValue(makeValuation({ peZone: 'low', pbZone: 'low' }));
    render(<ValuationTag stockCode="600000" />);
    await waitFor(() => {
      const peTag = screen.getByText('PE 25% 低估');
      expect(peTag).toHaveStyle({ color: '#52c41a' });
    });
  });

  it('applies blue color for fair zone tags', async () => {
    mockGetValuation.mockResolvedValue(makeValuation({
      pePercentile: 50,
      peZone: 'fair',
    }));
    render(<ValuationTag stockCode="600000" />);
    await waitFor(() => {
      const peTag = screen.getByText('PE 50% 合理');
      expect(peTag).toHaveStyle({ color: '#667eea' });
    });
  });

  it('applies red color for high zone tags', async () => {
    mockGetValuation.mockResolvedValue(makeValuation({
      pePercentile: 80,
      peZone: 'high',
    }));
    render(<ValuationTag stockCode="600000" />);
    await waitFor(() => {
      const peTag = screen.getByText('PE 80% 高估');
      expect(peTag).toHaveStyle({ color: '#ff4d4f' });
    });
  });
});
