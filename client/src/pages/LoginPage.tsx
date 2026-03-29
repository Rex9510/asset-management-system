import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { registerUser, loginUser } from '../api/auth';
import type { ApiErrorResponse } from '../api/client';
import type { AxiosError } from 'axios';

type TabType = 'login' | 'register';

const REMEMBER_USERNAME_KEY = 'remember_username';
const REMEMBER_PASSWORD_KEY = 'remember_password';
const REMEMBER_ENABLED_KEY = 'remember_enabled';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabType>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 加载记住的账号密码
  useEffect(() => {
    const enabled = localStorage.getItem(REMEMBER_ENABLED_KEY) === 'true';
    if (enabled) {
      const savedUsername = localStorage.getItem(REMEMBER_USERNAME_KEY) || '';
      const savedPassword = localStorage.getItem(REMEMBER_PASSWORD_KEY) || '';
      setUsername(savedUsername);
      setPassword(savedPassword);
      setRememberMe(true);
    }
  }, []);

  const validate = (): string | null => {
    if (!username.trim()) return '请输入用户名';
    if (!password) return '请输入密码';
    if (password.length < 3) return '密码长度不能少于3位';
    if (!agreedTerms) return '必须同意用户协议和免责声明才能登录';
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
        ? await loginUser(username.trim(), password, agreedTerms)
        : await registerUser(username.trim(), password, agreedTerms);

      localStorage.setItem('token', result.token);
      localStorage.setItem('user', JSON.stringify(result.user));

      // 记住账号密码处理
      if (tab === 'login' && rememberMe) {
        localStorage.setItem(REMEMBER_USERNAME_KEY, username);
        localStorage.setItem(REMEMBER_PASSWORD_KEY, password);
        localStorage.setItem(REMEMBER_ENABLED_KEY, 'true');
      } else if (tab === 'login' && !rememberMe) {
        localStorage.removeItem(REMEMBER_USERNAME_KEY);
        localStorage.removeItem(REMEMBER_PASSWORD_KEY);
        localStorage.removeItem(REMEMBER_ENABLED_KEY);
      }

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
      <h1 style={styles.title}>投资喵</h1>

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

        {tab === 'login' && (
          <label style={styles.rememberLabel}>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              style={styles.rememberCheckbox}
            />
            <span style={styles.rememberText}>记住账号密码</span>
          </label>
        )}

        {(tab === 'register' || tab === 'login') && (
          <label style={styles.agreeLabel}>
            <input
              type="checkbox"
              checked={agreedTerms}
              onChange={(e) => setAgreedTerms(e.target.checked)}
              style={styles.agreeCheckbox}
            />
            <span style={styles.agreeText}>
              我已阅读并同意
              <button
                type="button"
                style={styles.termsLink}
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/terms');
                }}
              >
                《用户协议与免责声明》
              </button>
            </span>
          </label>
        )}

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
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    marginBottom: '36px',
    color: '#fff',
    textShadow: '0 2px 10px rgba(0,0,0,0.15)',
    letterSpacing: '1px',
  },
  tabs: {
    display: 'flex',
    width: '100%',
    maxWidth: '320px',
    marginBottom: '20px',
    borderRadius: '12px',
    overflow: 'hidden',
    background: 'rgba(255,255,255,0.15)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: '1px solid rgba(255,255,255,0.2)',
  },
  tab: {
    flex: 1,
    padding: '12px 0',
    fontSize: '15px',
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    minHeight: '44px',
    fontWeight: 500,
  },
  tabActive: {
    flex: 1,
    padding: '12px 0',
    fontSize: '15px',
    border: 'none',
    background: 'rgba(255,255,255,0.95)',
    color: '#4f46e5',
    cursor: 'pointer',
    fontWeight: 600,
    minHeight: '44px',
    borderRadius: '10px',
    margin: '2px',
  },
  form: {
    width: '100%',
    maxWidth: '320px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    background: 'rgba(255,255,255,0.12)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderRadius: '16px',
    padding: '24px 20px',
    border: '1px solid rgba(255,255,255,0.2)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    fontSize: '15px',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: '10px',
    outline: 'none',
    boxSizing: 'border-box',
    minHeight: '44px',
    background: 'rgba(255,255,255,0.9)',
    color: '#1a1a2e',
    transition: 'all 0.2s ease',
  },
  error: {
    color: '#ffd6d6',
    fontSize: '13px',
    margin: 0,
    textAlign: 'center' as const,
    textShadow: '0 1px 2px rgba(0,0,0,0.1)',
  },
  button: {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    fontWeight: 600,
    color: '#4f46e5',
    background: 'rgba(255,255,255,0.95)',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    minHeight: '44px',
    boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
    letterSpacing: '0.5px',
  },
  rememberLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  rememberCheckbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer',
  },
  rememberText: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.9)',
  },
  agreeLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  agreeCheckbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer',
    marginTop: '2px',
    flexShrink: 0,
  },
  agreeText: {
    fontSize: '13px',
    lineHeight: 1.5,
    color: 'rgba(255,255,255,0.9)',
  },
  termsLink: {
    background: 'none',
    border: 'none',
    color: '#fff',
    textDecoration: 'underline',
    cursor: 'pointer',
    padding: 0,
    fontSize: '13px',
    fontWeight: 600,
  },
};

export default LoginPage;
