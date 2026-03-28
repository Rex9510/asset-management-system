import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

jest.mock('./api/messages', () => ({
  getUnreadCount: jest.fn().mockResolvedValue(0),
  getDailyPicks: jest.fn().mockResolvedValue([]),
}));

jest.mock('./api/positions', () => ({
  getPositions: jest.fn().mockResolvedValue([]),
}));

// Mock lazy-loaded page components to avoid dynamic import issues in Jest
jest.mock('./pages/DashboardPage', () => ({
  __esModule: true,
  default: () => <div data-testid="dashboard-page">每日关注</div>,
}));

jest.mock('./pages/PositionPage', () => ({
  __esModule: true,
  default: () => <div data-testid="position-page">持仓</div>,
}));

jest.mock('./pages/ChatPage', () => ({
  __esModule: true,
  default: () => <div data-testid="chat-page">对话</div>,
}));

jest.mock('./pages/MessageCenterPage', () => ({
  __esModule: true,
  default: () => <div data-testid="messages-page">消息中心</div>,
}));

jest.mock('./pages/ProfilePage', () => ({
  __esModule: true,
  default: () => <div data-testid="profile-page">我的</div>,
}));

// Need to import App after mocks are set up
import App from './App';

beforeEach(() => {
  localStorage.clear();
});

describe('App routing', () => {
  it('redirects to login when not authenticated and visiting /dashboard', async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <App />
        </MemoryRouter>
      );
    });
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
  });

  it('redirects / to /dashboard (then to login if unauthenticated)', async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      );
    });
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
  });

  it('redirects unknown routes to /dashboard (then to login if unauthenticated)', async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/unknown-page']}>
          <App />
        </MemoryRouter>
      );
    });
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
  });

  it('shows dashboard page when authenticated', async () => {
    localStorage.setItem('token', 'test-token');
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <App />
        </MemoryRouter>
      );
    });
    await waitFor(() => {
      expect(screen.getByText('每日关注', { exact: false })).toBeInTheDocument();
    });
  });

  it('shows login page at /login without redirect', async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/login']}>
          <App />
        </MemoryRouter>
      );
    });
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
  });

  it('shows bottom nav on authenticated pages', async () => {
    localStorage.setItem('token', 'test-token');
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <App />
        </MemoryRouter>
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: '底部导航' })).toBeInTheDocument();
    });
  });

  it('does not show bottom nav on login page', async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/login']}>
          <App />
        </MemoryRouter>
      );
    });
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '底部导航' })).not.toBeInTheDocument();
  });
});

describe('Code splitting', () => {
  it('App uses Suspense wrapper for lazy-loaded routes', async () => {
    localStorage.setItem('token', 'test-token');
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <App />
        </MemoryRouter>
      );
    });
    // Lazy-loaded component should render within Suspense
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
  });
});
