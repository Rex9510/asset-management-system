import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import ProfilePage from './ProfilePage';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('../api/auth', () => ({
  logoutUser: jest.fn(),
}));

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../components/ProfitChart', () => ({
  __esModule: true,
  default: () => <div data-testid="profit-chart-mock">ProfitChart</div>,
}));

jest.mock('../components/SectorPieChart', () => ({
  __esModule: true,
  default: () => <div data-testid="sector-pie-mock">SectorPieChart</div>,
}));

const authApi = require('../api/auth') as { logoutUser: jest.Mock };
const apiClient = require('../api/client').default as { get: jest.Mock };

function renderPage() {
  return render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('user', JSON.stringify({ id: 1, username: 'testuser' }));
  localStorage.setItem('token', 'test-token');
  authApi.logoutUser.mockResolvedValue(undefined);
  apiClient.get.mockResolvedValue({ data: { totalPicks: 86, profitCount: 58, lossCount: 28, avgReturn: 4.2, winRate: 0.674 } });
});

describe('ProfilePage', () => {
  it('displays username from localStorage', async () => {
    await act(async () => { renderPage(); });
    expect(screen.getByTestId('username')).toHaveTextContent('testuser');
  });

  it('shows "未登录" when no user in localStorage', async () => {
    localStorage.removeItem('user');
    await act(async () => { renderPage(); });
    expect(screen.getByTestId('username')).toHaveTextContent('未登录');
  });

  it('shows avatar with emoji matching prototype', async () => {
    await act(async () => { renderPage(); });
    expect(screen.getByTestId('user-avatar')).toHaveTextContent('👤');
  });

  it('renders accuracy overview card when data available', async () => {
    await act(async () => { renderPage(); });
    await waitFor(() => {
      expect(screen.getByTestId('accuracy-overview')).toBeInTheDocument();
    });
    expect(screen.getByText('每日关注准确率', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('86')).toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
    expect(screen.getByText('+4.2%')).toBeInTheDocument();
    expect(screen.getByText('67.4%', { exact: false })).toBeInTheDocument();
  });

  it('renders lazy-loaded chart components', async () => {
    await act(async () => { renderPage(); });
    await waitFor(() => {
      expect(screen.getByTestId('sector-pie-mock')).toBeInTheDocument();
      expect(screen.getByTestId('profit-chart-mock')).toBeInTheDocument();
    });
  });

  it('renders menu items matching prototype order', async () => {
    await act(async () => { renderPage(); });
    expect(screen.getByTestId('menu-oplog')).toHaveTextContent('操作复盘');
    expect(screen.getByTestId('menu-analysis-history')).toHaveTextContent('历史参考记录');
    expect(screen.getByTestId('menu-accuracy-stats')).toHaveTextContent('AI准确率统计');
    expect(screen.getByTestId('menu-analysis-settings')).toHaveTextContent('分析设置');
    expect(screen.getByTestId('menu-notification-settings')).toHaveTextContent('通知设置');
  });

  it('navigates to correct path on menu item click', async () => {
    await act(async () => { renderPage(); });
    fireEvent.click(screen.getByTestId('menu-oplog'));
    expect(mockNavigate).toHaveBeenCalledWith('/oplog');
  });

  it('renders logout button at bottom', async () => {
    await act(async () => { renderPage(); });
    expect(screen.getByTestId('logout-btn')).toHaveTextContent('退出登录');
  });

  it('calls logoutUser and clears localStorage on logout', async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, href: '/profile' },
    });

    await act(async () => { renderPage(); });
    await act(async () => {
      fireEvent.click(screen.getByTestId('logout-btn'));
    });

    await waitFor(() => {
      expect(authApi.logoutUser).toHaveBeenCalled();
    });
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(window.location.href).toBe('/login');

    Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
  });

  it('handles logout even when API fails', async () => {
    authApi.logoutUser.mockRejectedValue(new Error('Network error'));
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, href: '/profile' },
    });

    await act(async () => { renderPage(); });
    await act(async () => {
      fireEvent.click(screen.getByTestId('logout-btn'));
    });

    await waitFor(() => {
      expect(localStorage.getItem('token')).toBeNull();
    });
    expect(window.location.href).toBe('/login');

    Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
  });
});
