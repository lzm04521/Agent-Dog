import React, { useState, useEffect } from 'react';
import { ServerManager } from './components/ServerManager';
import { ProviderManager } from './components/ai/ProviderManager';
import { useWebSocket } from './hooks/useWebSocket';
import { useAppStore } from './store/useAppStore';
import { useConfigStore } from './store/configStore';
import { apiClient } from './utils/api';
import { ThemeProvider } from './contexts/ThemeContext';
import { Header } from './components/Header';

function App() {
  const { connected } = useAppStore();
  const { setAuthState } = useConfigStore();
  const [view, setView] = useState<'mcp' | 'ai'>('mcp');
  const [authState, setLocalAuthState] = useState<{
    loading: boolean;
    authenticated: boolean;
    required: boolean;
  }>({ loading: true, authenticated: false, required: false });
  
  // 连接WebSocket并获取刷新功能
  const { refreshServerTools } = useWebSocket(process.env.NODE_ENV === 'development' ? 'http://localhost:61125' : window.location.origin);

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
      setAuthState(status.required, status.authenticated ? localStorage.getItem('mcpdog_token') : null);
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
        <div className="min-h-screen bg-base-100 flex items-center justify-center">
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

  return (
    <ThemeProvider>
      {/* 锁定视口高度，整页不滚动；左右栏各自内部滚动 */}
      <div className="h-screen overflow-hidden bg-base-100 flex flex-col">
        {/* Header */}
        <Header />

        {/* 视图切换：MCP 服务器 / AI 供应商 */}
        <div className="px-4 sm:px-6 pt-4">
          <div role="tablist" className="tabs tabs-boxed tabs-sm w-fit">
            <button
              role="tab"
              className={`tab ${view === 'mcp' ? 'tab-active' : ''}`}
              onClick={() => setView('mcp')}
            >MCP 服务器</button>
            <button
              role="tab"
              className={`tab ${view === 'ai' ? 'tab-active' : ''}`}
              onClick={() => setView('ai')}
            >AI 供应商</button>
          </div>
        </div>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden w-full px-4 sm:px-6 py-8">
          {/* Global Status Alert */}
          {!connected && (
            <div className="alert alert-warning mb-8">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-yellow-400 dark:text-yellow-300" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium">
                    连接已断开
                  </h3>
                  <div className="mt-1 text-sm">
                    <p>无法连接到 MCPDog 服务器。请确认服务器正在运行，并检查网络连接。</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 主区：MCP 服务器管理 / AI 供应商维护 */}
          <div className="h-full">
            {view === 'mcp' ? (
              <ServerManager
                refreshServerTools={refreshServerTools}
                onLogout={authState.required ? handleLogout : undefined}
              />
            ) : (
              <div className="h-full overflow-y-auto">
                <ProviderManager />
              </div>
            )}
          </div>
        </main>
      </div>
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
    <div className="min-h-screen bg-base-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h2 className="mt-6 text-3xl font-extrabold text-base-content">
            MCPDog 身份验证
          </h2>
          <p className="mt-2 text-sm text-base-content/70">
            请输入你的身份验证令牌以继续
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
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
  );
}

export default App;