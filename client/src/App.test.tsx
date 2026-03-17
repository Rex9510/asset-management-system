import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import App from './App';

jest.mock('./api/messages', () => ({
  getUnreadCount: jest.fn().mockResolvedValue(0),
}));

beforeEach(() => {
  localStorage.clear();
});

describe('App routing', () => {
  it('redirects to login when not authenticated and visiting /dashboard', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
  });

  it('redirects / to /dashboard (then to login if unauthenticated)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
  });

  it('redirects unknown routes to /dashboard (then to login if unauthenticated)', () => {
    render(
      <MemoryRouter initialEntries={['/unknown-page']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
  });

  it('shows dashboard page when authenticated', () => {
    localStorage.setItem('token', 'test-token');
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: '看板' })).toBeInTheDocument();
  });

  it('shows login page at /login without redirect', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
  });

  it('shows bottom nav on authenticated pages', () => {
    localStorage.setItem('token', 'test-token');
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByRole('navigation', { name: '底部导航' })).toBeInTheDocument();
  });

  it('does not show bottom nav on login page', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.queryByRole('navigation', { name: '底部导航' })).not.toBeInTheDocument();
  });
});
