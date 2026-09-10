import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Server, Sparkles, Github, Dog, LayoutDashboard, ScrollText, ChevronDown, History, FileCog } from 'lucide-react';
import { apiClient } from '../utils/api';
import { useAppStore } from '../store/useAppStore';
import { ThemeToggle } from './ThemeToggle';

const GITHUB_URL = 'https://github.com/lzm04521/Agent-Dog';

// 双层菜单：控制台单页 + MCP 服务器 / AI 供应商两个分组（手风琴式，当前路由分组自动展开）
interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}
interface NavGroup {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  prefix: string;      // 组内路由公共前缀（展开判定）
  items: NavItem[];
}

const consoleItem: NavItem = { to: '/dashboard', label: '控制台', icon: LayoutDashboard };

const navGroups: NavGroup[] = [
  {
    label: 'MCP 服务器',
    icon: Server,
    prefix: '/mcp',
    items: [
      { to: '/mcp', label: '服务器管理', icon: Server },
      { to: '/mcp/logs', label: '日志', icon: ScrollText },
    ],
  },
  {
    label: 'AI 供应商',
    icon: Sparkles,
    prefix: '/providers',
    items: [
      { to: '/providers', label: '供应商管理', icon: Sparkles },
      { to: '/providers/logs', label: '调用日志', icon: History },
    ],
  },
];

// 组内高亮：最长前缀命中者激活（/mcp/add 归"服务器管理"，/mcp/logs 归"日志"，互斥）
function activeItemOf(pathname: string, group: NavGroup): NavItem | undefined {
  const hits = group.items.filter((i) => pathname === i.to || pathname.startsWith(i.to + '/'));
  if (hits.length === 0) return undefined;
  return hits.reduce((a, b) => (b.to.length > a.to.length ? b : a));
}

function groupOf(pathname: string): NavGroup | undefined {
  return navGroups.find((g) => pathname === g.prefix || pathname.startsWith(g.prefix + '/'));
}

// 整体框架（参考 gemini2api 设计语言）：sticky 玻璃顶栏 + 240px 玻璃侧边栏 + 撑满内容区
export const AppLayout: React.FC<{ outletContext?: unknown }> = ({ outletContext }) => {
  const [version, setVersion] = useState<string>('');
  const [configPath, setConfigPath] = useState<string>('');
  const { connected } = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();
  // 手风琴：默认跟随当前路由分组展开；用户点击组头可临时覆盖，路由切换后回归自动
  const [manualOpen, setManualOpen] = useState<string | null | undefined>(undefined);

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

  // 路由变化时清除手动覆盖，让所在分组自动展开
  useEffect(() => {
    setManualOpen(undefined);
  }, [location.pathname]);

  const activeGroup = groupOf(location.pathname);
  const openGroup = manualOpen !== undefined ? manualOpen : activeGroup?.label ?? null;

  const toggleGroup = (group: NavGroup) => {
    if (openGroup === group.label) {
      setManualOpen(null); // 已展开：收起
    } else {
      setManualOpen(group.label);
      navigate(group.items[0].to); // 收起态点击：展开并直达默认页
    }
  };

  const renderSubItem = (item: NavItem, group: NavGroup) => {
    const active = activeItemOf(location.pathname, group) === item;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={`flex items-center gap-2.5 px-3 py-1.5 pl-9 rounded-field text-[13px] transition-colors ${
          active
            ? 'bg-primary/10 text-primary font-semibold'
            : 'text-base-content/55 hover:bg-base-100 hover:text-base-content'
        }`}
      >
        {item.label}
      </NavLink>
    );
  };

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

      <div className="flex gap-4 lg:gap-6 w-full p-4 lg:p-6 items-start">
        {/* 侧边栏：双层菜单（手风琴）+ 底部信息 */}
        <aside className="glass w-[240px] shrink-0 sticky top-[4.5rem] hidden md:flex flex-col gap-1 p-3 rounded-box border border-base-300 shadow-sm">
          <NavLink
            to={consoleItem.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-field text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-base-content/60 hover:bg-base-100 hover:text-base-content'
              }`
            }
          >
            <consoleItem.icon className="w-[18px] h-[18px] shrink-0" />
            {consoleItem.label}
          </NavLink>

          {navGroups.map((group) => {
            const GroupIcon = group.icon;
            const groupActive = activeGroup?.label === group.label;
            const open = openGroup === group.label;
            return (
              <div key={group.label} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-field text-sm font-medium transition-colors cursor-pointer ${
                    groupActive
                      ? 'text-primary font-semibold'
                      : 'text-base-content/60 hover:bg-base-100 hover:text-base-content'
                  }`}
                >
                  <GroupIcon className="w-[18px] h-[18px] shrink-0" />
                  {group.label}
                  <ChevronDown
                    className={`w-3.5 h-3.5 ml-auto shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
                  />
                </button>
                {open && (
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((item) => renderSubItem(item, group))}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        {/* 窄屏：横向图标导航 + 当前分组二级横排 */}
        <nav className="md:hidden fixed bottom-3 left-1/2 -translate-x-1/2 z-30 glass flex flex-col gap-1 p-1.5 rounded-2xl border border-base-300 shadow-md max-w-[94vw]">
          <div className="flex gap-1">
            <NavLink
              to={consoleItem.to}
              title={consoleItem.label}
              className={({ isActive }) =>
                `flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
                  isActive ? 'bg-primary/10 text-primary' : 'text-base-content/60'
                }`
              }
            >
              <consoleItem.icon className="w-[18px] h-[18px]" />
            </NavLink>
            {navGroups.map((group) => {
              const GroupIcon = group.icon;
              const groupActive = groupOf(location.pathname)?.label === group.label;
              return (
                <NavLink
                  key={group.label}
                  to={group.items[0].to}
                  title={group.label}
                  className={() =>
                    `flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
                      groupActive ? 'bg-primary/10 text-primary' : 'text-base-content/60'
                    }`
                  }
                >
                  <GroupIcon className="w-[18px] h-[18px]" />
                </NavLink>
              );
            })}
          </div>
          {activeGroup && (
            <div className="flex gap-1 px-1 pb-0.5 overflow-x-auto scrollbar-thin">
              {activeGroup.items.map((item) => {
                const active = activeItemOf(location.pathname, activeGroup) === item;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={`shrink-0 px-2.5 py-1 rounded-full text-[12px] transition-colors ${
                      active
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-base-content/55 hover:text-base-content'
                    }`}
                  >
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          )}
        </nav>

        {/* 主内容区 */}
        <main className="flex-1 min-w-0 page-fade pb-24 md:pb-6">
          <Outlet context={outletContext} />
        </main>
      </div>
    </div>
  );
};
