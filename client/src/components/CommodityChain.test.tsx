import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CommodityChain from './CommodityChain';
import * as chainApi from '../api/chain';

jest.mock('../api/chain');

const mockGetChainStatus = chainApi.getChainStatus as jest.MockedFunction<typeof chainApi.getChainStatus>;

const mockChainData: chainApi.ChainStatusData = {
  nodes: [
    { symbol: '518880', name: '黄金', shortName: 'Au', status: 'activated', change10d: 146.5, label: '主升浪已走' },
    { symbol: '161226', name: '白银', shortName: 'Ag', status: 'activated', change10d: 304.8, label: '长期大牛' },
    { symbol: '161129', name: '原油', shortName: '油', status: 'transmitting', change10d: 85.3, label: '传导进行中' },
    { symbol: '512400', name: '有色', shortName: 'Cu', status: 'transmitting', change10d: 59.5, label: '传导进行中' },
    { symbol: '516020', name: '化工', shortName: '化', status: 'transmitting', change10d: 5.1, label: '蓄势待发' },
    { symbol: '159886', name: '橡胶', shortName: '胶', status: 'inactive', change10d: 1.9, label: '可埋伏' },
    { symbol: '515220', name: '煤炭', shortName: '煤', status: 'inactive', change10d: -41.9, label: '可埋伏' },
  ],
  updatedAt: '2026-03-20T16:10:00Z',
};

describe('CommodityChain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    mockGetChainStatus.mockReturnValue(new Promise(() => {}));
    render(<CommodityChain />);
    expect(screen.getByTestId('chain-loading')).toBeInTheDocument();
  });

  it('hides when API fails', async () => {
    mockGetChainStatus.mockRejectedValue(new Error('Network error'));
    const { container } = render(<CommodityChain />);
    await waitFor(() => {
      expect(screen.queryByTestId('chain-loading')).not.toBeInTheDocument();
    });
    expect(container.querySelector('[data-testid="commodity-chain-card"]')).not.toBeInTheDocument();
  });

  it('renders card title and period badge', async () => {
    mockGetChainStatus.mockResolvedValue(mockChainData);
    render(<CommodityChain />);
    await waitFor(() => {
      expect(screen.getByText('📦 商品传导链')).toBeInTheDocument();
    });
    expect(screen.getByText('主3～5年')).toBeInTheDocument();
  });

  it('renders all 7 chain nodes with shortNames in circles', async () => {
    mockGetChainStatus.mockResolvedValue(mockChainData);
    render(<CommodityChain />);
    await waitFor(() => {
      expect(screen.getByTestId('chain-row')).toBeInTheDocument();
    });
    expect(screen.getByText('Au')).toBeInTheDocument();
    expect(screen.getByText('Ag')).toBeInTheDocument();
    expect(screen.getByText('Cu')).toBeInTheDocument();
    expect(screen.getByText('油')).toBeInTheDocument();
    expect(screen.getByText('化')).toBeInTheDocument();
    expect(screen.getByText('胶')).toBeInTheDocument();
    expect(screen.getByText('煤')).toBeInTheDocument();
  });

  it('shows full names below circles', async () => {
    mockGetChainStatus.mockResolvedValue(mockChainData);
    render(<CommodityChain />);
    await waitFor(() => {
      expect(screen.getByText('黄金')).toBeInTheDocument();
    });
    expect(screen.getByText('白银')).toBeInTheDocument();
    expect(screen.getByText('原油')).toBeInTheDocument();
    expect(screen.getByText('有色')).toBeInTheDocument();
    expect(screen.getByText('化工')).toBeInTheDocument();
    expect(screen.getByText('橡胶')).toBeInTheDocument();
    expect(screen.getByText('煤炭')).toBeInTheDocument();
  });

  it('applies correct status colors via data-status attribute', async () => {
    mockGetChainStatus.mockResolvedValue(mockChainData);
    render(<CommodityChain />);
    await waitFor(() => {
      expect(screen.getByTestId('chain-node-518880')).toBeInTheDocument();
    });
    expect(screen.getByTestId('chain-node-518880')).toHaveAttribute('data-status', 'activated');
    expect(screen.getByTestId('chain-node-161226')).toHaveAttribute('data-status', 'activated');
    expect(screen.getByTestId('chain-node-161129')).toHaveAttribute('data-status', 'transmitting');
    expect(screen.getByTestId('chain-node-512400')).toHaveAttribute('data-status', 'transmitting');
    expect(screen.getByTestId('chain-node-159886')).toHaveAttribute('data-status', 'inactive');
    expect(screen.getByTestId('chain-node-515220')).toHaveAttribute('data-status', 'inactive');
  });

  it('renders arrows between nodes', async () => {
    mockGetChainStatus.mockResolvedValue(mockChainData);
    render(<CommodityChain />);
    await waitFor(() => {
      expect(screen.getByTestId('chain-row')).toBeInTheDocument();
    });
    const arrows = screen.getAllByText('→');
    expect(arrows).toHaveLength(6);
  });

  it('displays change percentages for each node', async () => {
    mockGetChainStatus.mockResolvedValue(mockChainData);
    render(<CommodityChain />);
    await waitFor(() => {
      expect(screen.getByText('+147%')).toBeInTheDocument(); // 146.5 rounds to 147
    });
    expect(screen.getByText('+305%')).toBeInTheDocument(); // 304.8 rounds to 305
    expect(screen.getByText('+85.3%')).toBeInTheDocument();
    expect(screen.getByText('+59.5%')).toBeInTheDocument();
    expect(screen.getByText('+5.1%')).toBeInTheDocument();
    expect(screen.getByText('+1.9%')).toBeInTheDocument();
    expect(screen.getByText('-41.9%')).toBeInTheDocument();
  });

  it('displays label tags from backend', async () => {
    mockGetChainStatus.mockResolvedValue(mockChainData);
    render(<CommodityChain />);
    await waitFor(() => {
      expect(screen.getByText('主升浪已走')).toBeInTheDocument();
    });
    expect(screen.getByText('长期大牛')).toBeInTheDocument();
    expect(screen.getAllByText('传导进行中')).toHaveLength(2);
    expect(screen.getByText('蓄势待发')).toBeInTheDocument();
    // 2 node labels + 1 legend item = 3
    expect(screen.getAllByText('可埋伏')).toHaveLength(3);
  });

  it('falls back to status label when node label is empty', async () => {
    const dataWithEmptyLabel: chainApi.ChainStatusData = {
      nodes: [
        { symbol: '518880', name: '黄金', shortName: 'Au', status: 'activated', change10d: 10, label: '' },
      ],
      updatedAt: '2026-03-20T16:10:00Z',
    };
    mockGetChainStatus.mockResolvedValue(dataWithEmptyLabel);
    render(<CommodityChain />);
    await waitFor(() => {
      // node fallback label + legend item = 2 occurrences of 已走主升
      const items = screen.getAllByText('已走主升');
      expect(items.length).toBe(2);
    });
  });

  it('renders legend with correct labels', async () => {
    mockGetChainStatus.mockResolvedValue(mockChainData);
    render(<CommodityChain />);
    await waitFor(() => {
      expect(screen.getByText('已走主升')).toBeInTheDocument();
    });
    expect(screen.getByText('传导中')).toBeInTheDocument();
    // 可埋伏 appears in legend AND in node labels, so check it exists
    const items = screen.getAllByText('可埋伏');
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('opens detail modal for full aux and window text, closes via button and backdrop', async () => {
    const longNote = '数据有限·主排名按实际约 100 日估算，仅供跟踪参考。';
    const data: chainApi.ChainStatusData = {
      ...mockChainData,
      nodes: mockChainData.nodes.map((n, i) =>
        i === 0
          ? {
              ...n,
              changeAux: 8.2,
              primaryWindowDays: 1000,
              maxHistoryDays: 1100,
              windowNote: longNote,
            }
          : n
      ),
    };
    mockGetChainStatus.mockResolvedValue(data);
    render(<CommodityChain />);
    await waitFor(() => expect(screen.getByTestId('chain-node-518880')).toBeInTheDocument());
    expect(screen.queryByTestId('chain-detail-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chain-node-518880'));
    await waitFor(() => expect(screen.getByTestId('chain-detail-dialog')).toBeInTheDocument());
    expect(screen.getByText(longNote)).toBeInTheDocument();
    expect(screen.getByText('主窗口约 1000 个交易日')).toBeInTheDocument();
    expect(screen.getByText('+8.2%')).toBeInTheDocument();
    expect(screen.getByText('可用历史约 1100 个交易日')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('关闭'));
    await waitFor(() => expect(screen.queryByTestId('chain-detail-dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId('chain-node-518880'));
    await waitFor(() => expect(screen.getByTestId('chain-detail-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('chain-detail-backdrop'));
    await waitFor(() => expect(screen.queryByTestId('chain-detail-dialog')).not.toBeInTheDocument());
  });

  it('closes detail modal on Escape', async () => {
    mockGetChainStatus.mockResolvedValue(mockChainData);
    render(<CommodityChain />);
    await waitFor(() => expect(screen.getByTestId('chain-node-518880')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('chain-node-518880'));
    await waitFor(() => expect(screen.getByTestId('chain-detail-dialog')).toBeInTheDocument());
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('chain-detail-dialog')).not.toBeInTheDocument());
  });
});
