import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@testing-library/jest-dom';
import LoginPage from './LoginPage';
import * as authApi from '../api/auth';

jest.mock('../api/auth');
jest.mock('../utils/toast', () => ({
  showErrorToast: jest.fn(),
}));

const mockedAuth = authApi as jest.Mocked<typeof authApi>;

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div data-testid="home-page">Home</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function submitBtn() {
  return screen.getByTestId('submit-btn');
}

async function agreeToTerms() {
  const checkboxes = screen.getAllByRole('checkbox');
  // 登录页：第 1 个为「记住账号密码」，第 2 个为「同意用户协议」；注册页仅协议一项
  const agreeBox = checkboxes[checkboxes.length - 1];
  await userEvent.click(agreeBox);
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

describe('LoginPage', () => {
  it('renders login form by default', () => {
    renderLoginPage();
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('密码')).toBeInTheDocument();
    expect(submitBtn()).toHaveTextContent('登录');
  });

  it('switches to register tab', () => {
    renderLoginPage();
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    expect(submitBtn()).toHaveTextContent('注册');
  });

  it('shows validation error when username is empty', () => {
    renderLoginPage();
    fireEvent.click(submitBtn());
    expect(screen.getByRole('alert')).toHaveTextContent('请输入用户名');
  });

  it('shows validation error when password is empty', () => {
    renderLoginPage();
    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'testuser' } });
    fireEvent.click(submitBtn());
    expect(screen.getByRole('alert')).toHaveTextContent('请输入密码');
  });

  it('shows validation error when password is too short', () => {
    renderLoginPage();
    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'ab' } });
    fireEvent.click(submitBtn());
    expect(screen.getByRole('alert')).toHaveTextContent('密码长度不能少于3位');
  });

  it('calls loginUser and stores token on successful login', async () => {
    mockedAuth.loginUser.mockResolvedValueOnce({
      token: 'jwt-token-123',
      user: { id: 1, username: 'testuser' },
    });

    renderLoginPage();
    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'password123' } });
    await agreeToTerms();
    fireEvent.click(submitBtn());

    await waitFor(() => {
      expect(mockedAuth.loginUser).toHaveBeenCalledWith('testuser', 'password123', true);
      expect(localStorage.getItem('token')).toBe('jwt-token-123');
      const storedUser = JSON.parse(localStorage.getItem('user')!);
      expect(storedUser).toEqual({ id: 1, username: 'testuser' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('home-page')).toBeInTheDocument();
    });
  });

  it('calls registerUser on register tab submit', async () => {
    mockedAuth.registerUser.mockResolvedValueOnce({
      token: 'new-token-456',
      user: { id: 2, username: 'newuser' },
    });

    renderLoginPage();
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'newuser' } });
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'password123' } });
    await agreeToTerms();
    fireEvent.click(submitBtn());

    await waitFor(() => {
      expect(mockedAuth.registerUser).toHaveBeenCalledWith('newuser', 'password123', true);
      expect(localStorage.getItem('token')).toBe('new-token-456');
      const storedUser = JSON.parse(localStorage.getItem('user')!);
      expect(storedUser).toEqual({ id: 2, username: 'newuser' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('home-page')).toBeInTheDocument();
    });
  });

  it('displays server error message on login failure', async () => {
    const axiosError = {
      response: {
        data: { error: { code: 'UNAUTHORIZED', message: '用户名或密码错误' } },
      },
    };
    mockedAuth.loginUser.mockRejectedValueOnce(axiosError);

    renderLoginPage();
    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'wrongpass' } });
    await agreeToTerms();
    fireEvent.click(submitBtn());

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('用户名或密码错误');
    });
  });

  it('clears error when switching tabs', () => {
    renderLoginPage();
    fireEvent.click(submitBtn());
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
