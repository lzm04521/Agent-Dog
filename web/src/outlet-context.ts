import { useOutletContext } from 'react-router-dom';

// 路由页面共享的上下文（由 App 经 AppLayout 的 Outlet 下发）
export interface AppOutletContext {
  refreshServerTools: (serverName?: string) => void;
  onLogout?: () => void;
}

export const useAppOutlet = () => useOutletContext<AppOutletContext>();
