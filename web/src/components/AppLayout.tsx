import React, { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Server, Sparkles, Github, Dog, LayoutDashboard, ScrollText, FileCog } from 'lucide-react';
import { apiClient } from '../utils/api';
import { useAppStore } from '../store/useAppStore';
import { ThemeToggle } from './ThemeToggle';

const GITHUB_URL = 'https://github.com/lzm04521/Agent-Dog';

// 整体框架（参考 gemini2api 设计语言）：sticky 玻璃顶栏 + 240px 玻璃侧边栏 + 1600px 内容区
export const AppLayout: React.FC<{ outletContext?: unknown }> = ({ outletContext }) => {
  const [version, setVersion] = useState<string>('');
  const [configPath, setConfigPath] = useState<string>('');
  const { connected } = useAppStore();

  useEffect(() => {
    apiClient
      .get('/api/system/info')
      .then((d: any) => {
        if (d?.version) setVersion(String(d.version));
        if (d?.configPath) setConfigPath(String(d.configPath));
      })
      .catch(() => {
        // 获取失败时隐藏对应元素，不影响主界面
      });
  }, []);

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/mcp', label: 'MCP 服务器', icon: Server },
    { to: '/providers', label: 'AI 供应商', icon: Sparkles },
    { to: '/logs', label: '全局日志', icon: ScrollText },
  ];

  return (
    <div className="min-h-screen bg-base-200 text-base-content">
      {/* 顶栏：品牌 + 运行状态 + 主题切换 + GitHub */}
      <header className="glass sticky top-0 z-30 flex items-center gap-3 px-4 lg:px-6 py-2.5 border-b border-base-300">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-content shadow-md shrink-0">
          <Dog className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="text-base font-bold leading-tight">AgentDog</div>
          <div className="hidden sm:block text-[11px] text-base-content/50">MCP 网关 + AI API 网关</div>
        </div>

        {/* 配置文件路径（悬停看全路径） */}
        {configPath && (
          <div
            className="hidden xl:flex items-center gap-1.5 ml-2 pl-3 border-l border-base-300 text-[11px] font-mono text-base-content/40 max-w-[340px] cursor-default"
            title={configPath}
          >
            <FileCog className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{configPath}</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <span
            className={`badge badge-sm gap-1.5 ${
              connected ? 'badge-success badge-outline' : 'badge-warning badge-outline'
            }`}
            title={configPath || undefined}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-success' : 'bg-warning'}`}
            ></span>
            {connected ? '运行中' : '已断开'}
            {version && <span>· v{version}</span>}
          </span>
          <ThemeToggle />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            title="GitHub 仓库"
            className="btn btn-ghost btn-sm btn-square"
          >
            <Github className="w-4 h-4" />
          </a>
        </div>
      </header>

      <div className="flex gap-4 lg:gap-6 max-w-[1600px] mx-auto p-4 lg:p-6 items-start">
        {/* 侧边栏：导航 + 底部信息 */}
        <aside className="glass w-[240px] shrink-0 sticky top-[4.5rem] hidden md:flex flex-col gap-1 p-3 rounded-box border border-base-300 shadow-sm">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-field text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-base-content/60 hover:bg-base-100 hover:text-base-content'
                }`
              }
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {label}
            </NavLink>
          ))}
        </aside>

        {/* 窄屏：横向图标导航 */}
        <nav className="md:hidden fixed bottom-3 left-1/2 -translate-x-1/2 z-30 glass flex gap-1 p-1.5 rounded-full border border-base-300 shadow-md">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={label}
              className={({ isActive }) =>
                `flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
                  isActive ? 'bg-primary/10 text-primary' : 'text-base-content/60'
                }`
              }
            >
              <Icon className="w-[18px] h-[18px]" />
            </NavLink>
          ))}
        </nav>

        {/* 主内容区 */}
        <main className="flex-1 min-w-0 page-fade pb-24 md:pb-6">
          <Outlet context={outletContext} />
        </main>
      </div>
    </div>
  );
};
