import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './DashboardPage';

jest.mock('../api/positions', () => ({
  getPositions: jest.fn(),
}));

jest.mock('../api/messages', () => ({
  getDailyPicks: jest.fn(),
  getUnreadCount: jest.fn().mockResolvedValue(0),
}));

const positionsApi = require('../api/positions') as { getPositions: jest.Mock };
const messagesApi = require('../api/messages') as { getDailyPicks: jest.Mock };

const holdingPosition = {
  id: 1, userId: 1, stockCode: '601398', stockName: '工商银行',
  positionType: 'holding', costPrice: 5, shares: 2000, buyDate: '2024-01-01',
  currentPrice: 6.0, profitLoss: 2000, profitLossPercent: 20, holdingDays: 60,
  createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
};

const watchingPosition = {
  id: 2, userId: 1, stockCode: '000001', stockName: '平安银行',
  positionType: 'watching', costPrice: null, shares: null, buyDate: null,
  currentPrice: 15.0, profitLoss: null, profitLossPercent: null, holdingDays: null,
  createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
};

const dailyPickMessage = {
  id: 1, stockCode: '600000', stockName: '浦发银行', summary: '每日关注',
  detail: JSON.stringify({
    picks: [{
      stockCode: '600000', stockName: '浦发银行', cycle: 'short',
      reason: 'MACD金叉', targetPriceRange: { low: 10, high: 12 },
      upsidePercent: 15, reasoning: '推理过程',
    }],
  }),
  createdAt: '2024-01-01T00:00:00Z',
};

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  positionsApi.getPositions.mockResolvedValue([holdingPosition]);
  messagesApi.getDailyPicks.mockResolvedValue([dailyPickMessage]);
});

describe('DashboardPage', () => {
  it('renders daily picks section', async () => {
    renderDashboard();
    expect(await screen.findByText('浦发银行')).toBeInTheDocument();
  });

  it('renders holding tab by default with positions', async () => {
    renderDashboard();
    expect(await screen.findByText('工商银行')).toBeInTheDocument();
    expect(positionsApi.getPositions).toHaveBeenCalledWith('holding');
  });

  it('switches to watching tab', async () => {
    positionsApi.getPositions.mockImplementation((type: string) =>
      type === 'watching' ? Promise.resolve([watchingPosition]) : Promise.resolve([holdingPosition])
    );
    renderDashboard();
    await screen.findByText('工商银行');

    fireEvent.click(screen.getByText('关注'));
    await waitFor(() => {
      expect(positionsApi.getPositions).toHaveBeenCalledWith('watching');
    });
  });

  it('shows empty state when no positions', async () => {
    positionsApi.getPositions.mockResolvedValue([]);
    renderDashboard();
    expect(await screen.findByText('暂无持仓记录')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    positionsApi.getPositions.mockRejectedValue(new Error('fail'));
    renderDashboard();
    expect(await screen.findByText('加载失败，请稍后重试')).toBeInTheDocument();
  });

  it('shows empty daily picks state', async () => {
    messagesApi.getDailyPicks.mockResolvedValue([]);
    renderDashboard();
    expect(await screen.findByText('暂无每日关注')).toBeInTheDocument();
  });

  it('refresh button triggers data reload', async () => {
    renderDashboard();
    await screen.findByText('工商银行');
    fireEvent.click(screen.getByLabelText('刷新数据'));
    await waitFor(() => {
      expect(positionsApi.getPositions).toHaveBeenCalledTimes(2);
    });
  });
});
