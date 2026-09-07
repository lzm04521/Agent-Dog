import React from 'react';
import { ServerManager } from '../components/ServerManager';
import { useAppOutlet } from '../outlet-context';

// MCP 管理页：WebSocket 在 App 顶层连接，经路由上下文下发刷新能力与登出
export const McpPage: React.FC = () => {
  const { refreshServerTools, onLogout } = useAppOutlet();

  return (
    // 固定视口高度：顶栏 + 内容区上下留白后剩余高度，供服务器列表/详情面板内部滚动
    <div className="h-[calc(100vh-7.5rem)] min-h-[480px] flex flex-col">
      <ServerManager refreshServerTools={refreshServerTools} onLogout={onLogout} />
    </div>
  );
};
