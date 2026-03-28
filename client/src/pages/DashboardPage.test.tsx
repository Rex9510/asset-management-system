import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './DashboardPage';

jest.mock('../api/messages', () => ({
  getDailyPicks: jest.fn(),
  getUnreadCount: jest.fn().mockResolvedValue(0),
}));

jest.mock('../api/positions', () => ({
  getPositions: jest.fn().mockResolvedValue([]),
  createPosition: jest.fn(),
}));

jest.mock('../api/marketEnv', () => ({
  getMarketEnv: jest.fn().mockResolvedValue({
    environment: 'sideways', label: '震荡 ⚖️', confidenceAdjust: 0, riskTip: null,
    indicators: { shIndex: { ma20Trend: 'up', ma60Trend: 'up' }, hs300: { ma20Trend: 'up', ma60Trend: 'up' }, volumeChange: 1.0, advanceDeclineRatio: 1.0 },
    updatedAt: '2024-01-01T00:00:00Z',
  }),
}));

jest.mock('../api/rotation', () => ({
  getRotationCurrent: jest.fn().mockResolvedValue({
    currentPhase: 'P1', phaseLabel: '科技成长', updatedAt: '2024-01-01T00:00:00Z',
  }),
}));

jest.mock('../api/sentiment', () => ({
  getSentimentCurrent: jest.fn().mockResolvedValue({
    score: 50, label: '中性', emoji: '😐', updatedAt: '2024-01-01T00:00:00Z',
  }),
}));

jest.mock('../api/chain', () => ({
  getChainStatus: jest.fn().mockResolvedValue({
    nodes: [], updatedAt: '2024-01-01T00:00:00Z',
  }),
}));

jest.mock('../api/events', () => ({
  getEvents: jest.fn().mockResolvedValue([]),
}));

jest.mock('../api/cycle', () => ({
  getCycleMonitors: jest.fn().mockResolvedValue([]),
  addCycleMonitor: jest.fn(),
  deleteCycleMonitor: jest.fn(),
}));

const messagesApi = require('../api/messages') as { getDailyPicks: jest.Mock };

const dailyPickMessage = {
  id: 1, stockCode: '600000', stockName: '浦发银行', summary: '每日关注',
  detail: JSON.stringify({
    stockCode: '600000', stockName: '浦发银行', period: 'short',
    periodLabel: '短期关注(1-2周)',
    reason: 'MACD金叉', targetPriceRange: { low: 10, high: 12 },
    estimatedUpside: 15,
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
  messagesApi.getDailyPicks.mockResolvedValue([dailyPickMessage]);
});

describe('DashboardPage', () => {
  it('renders daily picks section with stock name', async () => {
    renderDashboard();
    expect(await screen.findByText('浦发银行')).toBeInTheDocument();
  });

  it('renders section title for daily picks', async () => {
    renderDashboard();
    expect(await screen.findByText(/今日关注/)).toBeInTheDocument();
  });

  it('shows empty daily picks state', async () => {
    messagesApi.getDailyPicks.mockResolvedValue([]);
    renderDashboard();
    expect(await screen.findByText('暂无今日关注')).toBeInTheDocument();
  });

  it('renders market status tags', async () => {
    renderDashboard();
    // MarketEnvTag, RotationTag, SentimentTag should render
    expect(await screen.findByTestId('marketenv-tag')).toBeInTheDocument();
    expect(await screen.findByTestId('rotation-tag')).toBeInTheDocument();
    expect(await screen.findByTestId('sentiment-tag')).toBeInTheDocument();
  });
});
