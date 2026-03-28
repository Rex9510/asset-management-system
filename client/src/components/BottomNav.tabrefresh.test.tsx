/**
 * BottomNav Tab 切换触发刷新事件测试
 * Task 1.6 (client-side)
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@testing-library/jest-dom';
import BottomNav from './BottomNav';

jest.mock('../api/messages', () => ({
  getUnreadCount: jest.fn().mockResolvedValue(0),
}));

function renderWithRouter(initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/dashboard" element={<><div data-testid="dashboard">看板</div><BottomNav /></>} />
        <Route path="/position" element={<><div data-testid="position">持仓</div><BottomNav /></>} />
        <Route path="/chat" element={<><div data-testid="chat">对话</div><BottomNav /></>} />
        <Route path="/messages" element={<><div data-testid="messages">消息</div><BottomNav /></>} />
        <Route path="/profile" element={<><div data-testid="profile">我的</div><BottomNav /></>} />
      </Routes>
    </MemoryRouter>
  );
}

// Feature: ai-investment-assistant-phase2, 一期行为调整
// 验证需求：BottomNav tab 切换触发 tab-switch-refresh 事件
test('tab 切换时触发 tab-switch-refresh 自定义事件', () => {
  const handler = jest.fn();
  window.addEventListener('tab-switch-refresh', handler);

  renderWithRouter('/dashboard');
  fireEvent.click(screen.getByLabelText('持仓'));

  expect(handler).toHaveBeenCalledTimes(1);
  const event = handler.mock.calls[0][0] as CustomEvent;
  expect(event.detail.tab).toBe('position');

  window.removeEventListener('tab-switch-refresh', handler);
});

test('每次 tab 切换都触发刷新事件', () => {
  const handler = jest.fn();
  window.addEventListener('tab-switch-refresh', handler);

  renderWithRouter('/dashboard');

  fireEvent.click(screen.getByLabelText('对话'));
  fireEvent.click(screen.getByLabelText('消息'));
  fireEvent.click(screen.getByLabelText('我的'));

  expect(handler).toHaveBeenCalledTimes(3);
  expect((handler.mock.calls[0][0] as CustomEvent).detail.tab).toBe('chat');
  expect((handler.mock.calls[1][0] as CustomEvent).detail.tab).toBe('messages');
  expect((handler.mock.calls[2][0] as CustomEvent).detail.tab).toBe('profile');

  window.removeEventListener('tab-switch-refresh', handler);
});
