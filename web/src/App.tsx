import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket';
import { useConfigStore } from './store/configStore';
import { apiClient } from './utils/api';
import { ThemeProvider } from './contexts/ThemeContext';
import { AppLayout } from './components/AppLayout';
import { McpPage } from './pages/McpPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { DashboardPage } from './pages/DashboardPage';
import { LogsPage } from './pages/LogsPage';
import type { AppOutletContext } from './outlet-context';

function App() {
  const { setAuthState } = useConfigStore();
  const [authState, setLocalAuthState] = useState<{
    loading: boolean;
    authenticated: boolean;
    required: boolean;
  }>({ loading: true, authenticated: false, required: false });

  // WebSocket 在最外层连接，保证切换路由时服务器状态与日志流不断开
  const { refreshServerTools } = useWebSocket(
    process.env.NODE_ENV === 'development' ? 'http://localhost:61125' : window.location.origin
  );

  // Check authentication status on app load
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const status = await apiClient.checkAuthStatus();
      setLocalAuthState({
        loading: false,
        authenticated: status.authenticated,
        required: status.required
      });

      // Update global store
      setAuthState(status.required, status.authenticated ? localStorage.getItem('agentdog_token') : null);
    } catch (error) {
      console.error('认证状态检查失败:', error);
      setLocalAuthState({
        loading: false,
        authenticated: false,
        required: false
      });

      // Update global store
      setAuthState(false, null);
    }
  };

  const handleLogin = async (token: string) => {
    try {
      await apiClient.login(token);
      setLocalAuthState(prev => ({ ...prev, authenticated: true }));

      // Update global store
      setAuthState(true, token);
    } catch (error) {
      throw error; // Let the login component handle the error
    }
  };

  const handleLogout = () => {
    apiClient.logout();
    setLocalAuthState(prev => ({ ...prev, authenticated: false }));

    // Update global store
    setAuthState(true, null);
  };

  // Show loading screen while checking auth
  if (authState.loading) {
    return (
      <ThemeProvider>
        <div className="min-h-screen bg-base-200 flex items-center justify-center">
          <div className="text-center">
          <span className="loading loading-spinner loading-lg text-primary"></span>
          <p className="mt-2 text-base-content">加载中...</p>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  // Show login screen if auth is required but user is not authenticated
  if (authState.required && !authState.authenticated) {
    return (
      <ThemeProvider>
        <LoginPage onLogin={handleLogin} />
      </ThemeProvider>
    );
  }

  const outletContext: AppOutletContext = {
    refreshServerTools,
    onLogout: authState.required ? handleLogout : undefined,
  };

  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout outletContext={outletContext} />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="mcp" element={<McpPage />} />
            <Route path="providers" element={<ProvidersPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

// Login Page Component
function LoginPage({ onLogin }: { onLogin: (token: string) => Promise<void> }) {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError('请输入访问令牌');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onLogin(token.trim());
    } catch (error) {
      setError((error as Error).message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-base-200 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="card bg-base-100 border border-base-300 shadow-sm rounded-2xl p-8">
          <div className="text-center mb-8">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-content text-2xl shadow-md">
              🐶
            </div>
            <h2 className="mt-4 text-2xl font-bold text-base-content">
              AgentDog 身份验证
            </h2>
            <p className="mt-2 text-sm text-base-content/60">
              请输入你的身份验证令牌以继续
            </p>
          </div>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="token" className="sr-only">
                身份验证令牌
              </label>
              <input
                id="token"
                name="token"
                type="password"
                required
                className="input input-bordered w-full"
                placeholder="请输入身份验证令牌"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="alert alert-error">
                {error}
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary w-full"
              >
                {loading ? (
                  <div className="flex items-center">
                    <span className="loading loading-spinner loading-sm mr-2"></span>
                    登录中...
                  </div>
                ) : (
                  '登录'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;
