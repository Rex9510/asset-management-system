/**
 * NotificationSettingsPage 交互测试
 * Task 28.1
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import NotificationSettingsPage from './NotificationSettingsPage';
import * as notificationApi from '../api/notification';

jest.mock('../api/notification');

const mockGetSettings = notificationApi.getNotificationSettings as jest.MockedFunction<typeof notificationApi.getNotificationSettings>;
const mockUpdateSettings = notificationApi.updateNotificationSettings as jest.MockedFunction<typeof notificationApi.updateNotificationSettings>;

const mockSettings: notificationApi.NotificationSetting[] = [
  { messageType: 'stop_loss_alert', label: '止损提醒', enabled: true },
  { messageType: 'rotation_switch', label: '轮动切换', enabled: false },
  { messageType: 'event_window', label: '事件窗口', enabled: true },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/notification-settings']}>
      <NotificationSettingsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSettings.mockResolvedValue(mockSettings);
  mockUpdateSettings.mockResolvedValue(undefined as any);
});

describe('NotificationSettingsPage', () => {
  it('shows loading skeleton initially', () => {
    mockGetSettings.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
  });

  it('renders all settings after loading', async () => {
    await act(async () => { renderPage(); });
    await waitFor(() => {
      expect(screen.getByText('止损提醒')).toBeInTheDocument();
    });
    expect(screen.getByText('轮动切换')).toBeInTheDocument();
    expect(screen.getByText('事件窗口')).toBeInTheDocument();
  });

  it('has back button', async () => {
    await act(async () => { renderPage(); });
    await waitFor(() => {
      expect(screen.getByTestId('back-btn')).toBeInTheDocument();
    });
  });

  it('shows header title', async () => {
    await act(async () => { renderPage(); });
    await waitFor(() => {
      expect(screen.getByText('通知设置')).toBeInTheDocument();
    });
  });

  it('toggle switches have correct initial state', async () => {
    await act(async () => { renderPage(); });
    await waitFor(() => {
      expect(screen.getByTestId('toggle-stop_loss_alert')).toBeInTheDocument();
    });

    const stopLossToggle = screen.getByTestId('toggle-stop_loss_alert');
    const rotationToggle = screen.getByTestId('toggle-rotation_switch');

    expect(stopLossToggle).toHaveAttribute('aria-checked', 'true');
    expect(rotationToggle).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles setting on click and calls API', async () => {
    await act(async () => { renderPage(); });
    await waitFor(() => {
      expect(screen.getByTestId('toggle-stop_loss_alert')).toBeInTheDocument();
    });

    const toggle = screen.getByTestId('toggle-stop_loss_alert');
    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(mockUpdateSettings).toHaveBeenCalledWith([
      { messageType: 'stop_loss_alert', enabled: false },
    ]);
  });

  it('shows footer note about message center', async () => {
    await act(async () => { renderPage(); });
    await waitFor(() => {
      expect(screen.getByText(/消息仍会保存在消息中心/)).toBeInTheDocument();
    });
  });

  it('shows empty state when no settings', async () => {
    mockGetSettings.mockResolvedValue([]);
    await act(async () => { renderPage(); });
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('toggle has role="switch" for accessibility', async () => {
    await act(async () => { renderPage(); });
    await waitFor(() => {
      expect(screen.getByTestId('toggle-stop_loss_alert')).toBeInTheDocument();
    });

    const toggles = screen.getAllByRole('switch');
    expect(toggles.length).toBe(3);
  });
});
