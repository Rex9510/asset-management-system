import axios, { AxiosHeaders } from 'axios';
import apiClient from './client';
import * as toast from '../utils/toast';

// Mock toast module
jest.mock('../utils/toast', () => ({
  showErrorToast: jest.fn(),
}));

// Mock axios adapter to intercept requests
const mockAdapter = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  // Override adapter to simulate responses
  apiClient.defaults.adapter = mockAdapter;
  // Reset location mock
  delete (window as any).location;
  (window as any).location = { pathname: '/dashboard', href: '' };
});

describe('apiClient request interceptor', () => {
  it('should attach Authorization header when token exists', async () => {
    localStorage.setItem('token', 'test-jwt-token');
    mockAdapter.mockResolvedValueOnce({
      status: 200,
      data: { ok: true },
      headers: {},
      config: {},
    });

    await apiClient.get('/health');
    const requestConfig = mockAdapter.mock.calls[0][0];
    expect(requestConfig.headers.get('Authorization')).toBe('Bearer test-jwt-token');
  });

  it('should not attach Authorization header when no token', async () => {
    mockAdapter.mockResolvedValueOnce({
      status: 200,
      data: { ok: true },
      headers: {},
      config: {},
    });

    await apiClient.get('/health');
    const requestConfig = mockAdapter.mock.calls[0][0];
    expect(requestConfig.headers.get('Authorization')).toBeUndefined();
  });
});

describe('apiClient response interceptor - 401 handling', () => {
  it('should clear token and redirect to /login on 401', async () => {
    localStorage.setItem('token', 'expired-token');
    mockAdapter.mockRejectedValueOnce(
      createAxiosError(401, { error: { code: 'UNAUTHORIZED', message: '未授权' } })
    );

    await expect(apiClient.get('/protected')).rejects.toThrow();
    expect(localStorage.getItem('token')).toBeNull();
    expect(window.location.href).toBe('/login');
  });

  it('should not redirect if already on /login', async () => {
    (window as any).location = { pathname: '/login', href: '/login' };
    mockAdapter.mockRejectedValueOnce(
      createAxiosError(401, { error: { code: 'UNAUTHORIZED', message: '未授权' } })
    );

    await expect(apiClient.get('/protected')).rejects.toThrow();
    expect(window.location.href).toBe('/login');
  });
});

describe('apiClient response interceptor - error toast', () => {
  it('should show toast for 4xx errors', async () => {
    mockAdapter.mockRejectedValueOnce(
      createAxiosError(400, { error: { code: 'BAD_REQUEST', message: '参数错误' } })
    );

    await expect(apiClient.post('/positions')).rejects.toThrow();
    expect(toast.showErrorToast).toHaveBeenCalledWith('参数错误');
  });

  it('should show toast for 5xx errors', async () => {
    mockAdapter.mockRejectedValueOnce(
      createAxiosError(500, { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } })
    );

    await expect(apiClient.get('/data')).rejects.toThrow();
    expect(toast.showErrorToast).toHaveBeenCalledWith('服务器内部错误');
  });

  it('should show default message for 5xx without message', async () => {
    mockAdapter.mockRejectedValueOnce(
      createAxiosError(502, {})
    );

    await expect(apiClient.get('/data')).rejects.toThrow();
    expect(toast.showErrorToast).toHaveBeenCalledWith('服务器繁忙，请稍后重试');
  });

  it('should show network error toast when no response', async () => {
    const networkError = new axios.AxiosError('Network Error');
    mockAdapter.mockRejectedValueOnce(networkError);

    await expect(apiClient.get('/data')).rejects.toThrow();
    expect(toast.showErrorToast).toHaveBeenCalledWith('网络异常，请检查网络连接');
  });
});

// Helper to create AxiosError-like rejection
function createAxiosError(status: number, data: any) {
  const error = new axios.AxiosError(
    `Request failed with status code ${status}`,
    String(status),
    undefined,
    undefined,
    {
      status,
      data,
      headers: new AxiosHeaders(),
      config: {} as any,
      statusText: '',
    }
  );
  return error;
}
