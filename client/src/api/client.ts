import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { showErrorToast } from '../utils/toast';

/**
 * Unified API error response structure from the backend.
 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Axios instance with base configuration and interceptors.
 */
const apiClient = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach auth token
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle errors globally
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorResponse>) => {
    if (!error.response) {
      // Network error or timeout
      showErrorToast('网络异常，请检查网络连接');
      return Promise.reject(error);
    }

    const { status, data } = error.response;
    const message = data?.error?.message;

    if (status === 401) {
      // Clear token and redirect to login
      localStorage.removeItem('token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    if (status >= 400 && status < 500) {
      showErrorToast(message || '请求错误');
    } else if (status >= 500) {
      showErrorToast(message || '服务器繁忙，请稍后重试');
    }

    return Promise.reject(error);
  }
);

export default apiClient;
