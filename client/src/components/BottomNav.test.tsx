import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@testing-library/jest-dom';
import BottomNav from './BottomNav';

jest.mock('../api/messages', () => ({
  getUnreadCount: jest.fn().mockResolvedValue(0),
}));

const messagesApi = require('../api/messages') as { getUnreadCount: jest.Mock };

function renderWithRouter(initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/dashboard" element={<><div data-testid="dashboard">看板</div><BottomNav /></>} />
        <Route path="/chat" element={<><div data-testid="chat">对话</div><BottomNav /></>} />
        <Route path="/messages" element={<><div data-testid="messages">消息</div><BottomNav /></>} />
        <Route path="/profile" element={<><div data-testid="profile">我的</div><BottomNav /></>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  messagesApi.getUnreadCount.mockResolvedValue(0);
});

describe('BottomNav', () => {
  it('renders all four tabs', () => {
    renderWithRouter();
    expect(screen.getByLabelText('看板')).toBeInTheDocument();
    expect(screen.getByLabelText('对话')).toBeInTheDocument();
    expect(screen.getByLabelText('消息')).toBeInTheDocument();
    expect(screen.getByLabelText('我的')).toBeInTheDocument();
  });

  it('highlights the current tab', () => {
    renderWithRouter('/dashboard');
    const dashboardTab = screen.getByLabelText('看板');
    expect(dashboardTab).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('对话')).not.toHaveAttribute('aria-current');
  });

  it('navigates to chat page on tab click', () => {
    renderWithRouter('/dashboard');
    fireEvent.click(screen.getByLabelText('对话'));
    expect(screen.getByTestId('chat')).toBeInTheDocument();
  });

  it('navigates to messages page on tab click', () => {
    renderWithRouter('/dashboard');
    fireEvent.click(screen.getByLabelText('消息'));
    expect(screen.getByTestId('messages')).toBeInTheDocument();
  });

  it('navigates to profile page on tab click', () => {
    renderWithRouter('/dashboard');
    fireEvent.click(screen.getByLabelText('我的'));
    expect(screen.getByTestId('profile')).toBeInTheDocument();
  });

  it('shows unread badge when count > 0', async () => {
    messagesApi.getUnreadCount.mockResolvedValue(5);
    renderWithRouter();
    const badge = await screen.findByText('5');
    expect(badge).toBeInTheDocument();
  });

  it('shows 99+ when unread count exceeds 99', async () => {
    messagesApi.getUnreadCount.mockResolvedValue(150);
    renderWithRouter();
    const badge = await screen.findByText('99+');
    expect(badge).toBeInTheDocument();
  });

  it('does not show badge when unread count is 0', () => {
    renderWithRouter();
    expect(screen.queryByLabelText(/未读消息/)).not.toBeInTheDocument();
  });
});
