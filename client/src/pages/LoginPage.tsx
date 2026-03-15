import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { registerUser, loginUser } from '../api/auth';
import type { ApiErrorResponse } from '../api/client';
import type { AxiosError } from 'axios';

type TabType = 'login' | 'register';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabType>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const validate = (): string | null => {
    if (!username.trim()) return '请输入用户名';
    if (!password) return '请输入密码';
    if (password.length < 3) return '密码长度不能少于3位';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const result = tab === 'login'
        ? await loginUser(username.trim(), password)
        : await registerUser(username.trim(), password);

      localStorage.setItem('token', result.token);
      navigate('/', { replace: true });
    } catch (err) {
      const axiosErr = err as AxiosError<ApiErrorResponse>;
      const msg = axiosErr.response?.data?.error?.message;
      setError(msg || '操作失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (newTab: TabType) => {
    setTab(newTab);
    setError('');
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>AI智能投资陪伴助手</h1>

      <div style={styles.tabs}>
        <button
          type="button"
          style={tab === 'login' ? styles.tabActive : styles.tab}
          onClick={() => switchTab('login')}
        >
          登录
        </button>
        <button
          type="button"
          style={tab === 'register' ? styles.tabActive : styles.tab}
          onClick={() => switchTab('register')}
        >
          注册
        </button>
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          type="text"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={styles.input}
          autoComplete="username"
        />
        <input
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
        />

        {error && <p style={styles.error} role="alert">{error}</p>}

        <button type="submit" style={styles.button} disabled={loading} data-testid="submit-btn">
          {loading ? '处理中...' : tab === 'login' ? '登录' : '注册'}
        </button>
      </form>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '0 24px',
    background: '#f5f5f5',
  },
  title: {
    fontSize: '22px',
    fontWeight: 700,
    marginBottom: '32px',
    color: '#333',
  },
  tabs: {
    display: 'flex',
    width: '100%',
    maxWidth: '320px',
    marginBottom: '20px',
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid #ddd',
  },
  tab: {
    flex: 1,
    padding: '10px 0',
    fontSize: '15px',
    border: 'none',
    background: '#fff',
    color: '#999',
    cursor: 'pointer',
    minHeight: '44px',
  },
  tabActive: {
    flex: 1,
    padding: '10px 0',
    fontSize: '15px',
    border: 'none',
    background: '#1677ff',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
    minHeight: '44px',
  },
  form: {
    width: '100%',
    maxWidth: '320px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  input: {
    width: '100%',
    padding: '12px',
    fontSize: '15px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    outline: 'none',
    boxSizing: 'border-box',
    minHeight: '44px',
  },
  error: {
    color: '#ff4d4f',
    fontSize: '13px',
    margin: 0,
    textAlign: 'center' as const,
  },
  button: {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    fontWeight: 600,
    color: '#fff',
    background: '#1677ff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    minHeight: '44px',
  },
};

export default LoginPage;
