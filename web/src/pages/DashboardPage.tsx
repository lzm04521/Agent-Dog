import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Server, Wrench, Sparkles, Timer, ArrowRight } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useConfigStore } from '../store/configStore';
import { useProviderStore } from '../store/providerStore';
import { apiClient } from '../utils/api';

interface SystemInfo {
  version?: string;
  nodeVersion?: string;
  platform?: string;
  configPath?: string;
  webPort?: number;
  mode?: string;
}

// Dashboard 概览页：统计卡 + 系统信息 + 服务器状态网格 + 实时事件预览
// 数据全部复用现有接口与 socket 推送（/api/system/info、status-update、providers store）
export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { systemStatus, events } = useAppStore();
  const servers = useConfigStore((s) => s.servers);
  const providers = useProviderStore((s) => s.providers);
  const gatewayStatus = useProviderStore((s) => s.gatewayStatus);
  const [sysInfo, setSysInfo] = useState<SystemInfo>({});

  useEffect(() => {
    // 服务器列表由 MCP 页的 loadConfig 拉取；从 Dashboard 直接进入时尚未加载，此处兜底
    if (useConfigStore.getState().servers.length === 0) {
      useConfigStore.getState().loadConfig().catch(() => {
        // 配置拉取失败不阻塞页面，统计卡显示 0
      });
    }
    apiClient
      .get('/api/system/info')
      .then((d: any) => setSysInfo(d || {}))
      .catch(() => {
        // 系统信息获取失败不阻塞页面，对应字段显示 —
      });
    useProviderStore.getState().loadAll().catch(() => {
      // AI 网关未启用或暂不可达时静默，卡片显示 —
    });
  }, []);

  const enabledServers = servers.filter((s) => s.enabled);
  const connectedCount = enabledServers.filter((s) => s.connected).length;
  const totalTools = systemStatus?.totalTools ?? servers.reduce((acc, s) => acc + (s.toolCount || 0), 0);
  const enabledProviders = providers.filter((p) => p.enabled).length;

  // uptime（秒，来自 status-update 载荷的 daemon.uptime）→ x天 x小时 x分
  const uptime = systemStatus?.daemon?.uptime;
  // Web 端口：优先取 system/info，缺失时回退当前页面端口
  const webPort = sysInfo.webPort ?? (typeof window !== 'undefined' ? Number(window.location.port) || undefined : undefined);
  const uptimeText =
    uptime === undefined || uptime === null
      ? '—'
      : uptime < 60
        ? `${Math.floor(uptime)}秒`
        : uptime < 3600
          ? `${Math.floor(uptime / 60)}分`
          : `${Math.floor(uptime / 86400)}天 ${Math.floor((uptime % 86400) / 3600)}时 ${Math.floor((uptime % 3600) / 60)}分`;

  const recentEvents = events.slice(0, 8);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-bold">控制台</h1>
        <span className="text-xs text-base-content/50">系统概览与运行状态</span>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="stats bg-base-100 border border-base-300 shadow-sm cursor-pointer" onClick={() => navigate('/mcp')}>
          <div className="stat p-4">
            <div className="stat-title text-xs flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5" /> MCP 服务器
            </div>
            <div className="stat-value text-2xl">
              {connectedCount}
              <span className="text-base font-normal text-base-content/40"> / {servers.length}</span>
            </div>
            <div className="stat-desc">{enabledServers.length} 个启用</div>
          </div>
        </div>

        <div className="stats bg-base-100 border border-base-300 shadow-sm cursor-pointer" onClick={() => navigate('/mcp')}>
          <div className="stat p-4">
            <div className="stat-title text-xs flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5" /> 聚合工具
            </div>
            <div className="stat-value text-2xl">{totalTools}</div>
            <div className="stat-desc">
              启用 {systemStatus?.enabledTools ?? servers.reduce((acc, s) => acc + (s.enabledToolCount || 0), 0)} 个
            </div>
          </div>
        </div>

        <div className="stats bg-base-100 border border-base-300 shadow-sm cursor-pointer" onClick={() => navigate('/providers')}>
          <div className="stat p-4">
            <div className="stat-title text-xs flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> AI 供应商
            </div>
            <div className="stat-value text-2xl">
              {enabledProviders}
              <span className="text-base font-normal text-base-content/40"> / {providers.length}</span>
            </div>
            <div className="stat-desc">
              {gatewayStatus?.running ? `网关运行中 · ${gatewayStatus.port}` : gatewayStatus?.enabled ? '网关启动中' : '网关未启用'}
            </div>
          </div>
        </div>

        <div className="stats bg-base-100 border border-base-300 shadow-sm">
          <div className="stat p-4">
            <div className="stat-title text-xs flex items-center gap-1.5">
              <Timer className="w-3.5 h-3.5" /> 运行时长
            </div>
            <div className="stat-value text-2xl">{uptimeText}</div>
            <div className="stat-desc">
              {systemStatus ? (systemStatus.daemon?.isRunning === false ? 'daemon 未运行' : '状态实时推送中') : '等待状态推送…'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 lg:gap-6">
        {/* 系统信息 */}
        <div className="card bg-base-100 border border-base-300 shadow-sm">
          <div className="card-body p-5 gap-0">
            <h2 className="card-title text-sm mb-2">系统信息</h2>
            {[
              ['版本', sysInfo.version ?? '—'],
              ['运行模式', sysInfo.mode ?? 'daemon'],
              ['Web 端口', webPort ? `${webPort} (localhost)` : '—'],
              ['配置路径', sysInfo.configPath ?? '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-1.5 text-sm border-b border-dashed border-base-300 last:border-0">
                <span className="text-base-content/60">{k}</span>
                <span className="font-medium font-mono text-xs truncate max-w-[60%]" title={v}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 服务器状态网格 */}
        <div className="card bg-base-100 border border-base-300 shadow-sm">
          <div className="card-body p-5">
            <h2 className="card-title text-sm justify-between">
              服务器状态
              <button className="btn btn-ghost btn-xs" onClick={() => navigate('/mcp')}>
                管理 <ArrowRight className="w-3 h-3" />
              </button>
            </h2>
            {servers.length === 0 ? (
              <div className="text-sm text-base-content/40 min-h-[120px] flex items-center justify-center text-center">
                暂无服务器，
                <span className="text-primary cursor-pointer" onClick={() => navigate('/mcp')}>去添加</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {servers.map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center gap-2 p-2.5 rounded-field border border-base-300 hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer"
                    onClick={() => navigate('/mcp')}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        !s.enabled ? 'bg-base-content/20' : s.connected ? 'bg-success' : 'bg-warning'
                      }`}
                    ></span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{s.name}</div>
                      <div className="text-[11px] text-base-content/40">
                        {s.transport} · {s.enabled ? `${s.toolCount} 工具` : '已停用'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 实时事件预览 */}
      <div className="card bg-base-100 border border-base-300 shadow-sm">
        <div className="card-body p-5">
          <h2 className="card-title text-sm justify-between">
            实时事件
            <button className="btn btn-ghost btn-xs" onClick={() => navigate('/logs')}>
              查看全部 <ArrowRight className="w-3 h-3" />
            </button>
          </h2>
          {recentEvents.length === 0 ? (
            <div className="text-sm text-base-content/40 py-4 text-center">暂无事件，等待实时推送…</div>
          ) : (
            <div className="log-terminal max-h-56 overflow-y-auto scrollbar-thin">
              {recentEvents.map((e, i) => (
                <div key={`${e.timestamp}-${i}`} className="flex gap-3">
                  <span className="log-time shrink-0">
                    {new Date(e.timestamp).toLocaleTimeString('zh-CN')}
                  </span>
                  <span
                    className={
                      e.type === 'server-error' || e.type === 'error'
                        ? 'log-err'
                        : e.type === 'server-connected' || e.type === 'tool-called'
                          ? 'log-ok'
                          : 'log-info'
                    }
                  >
                    [{e.type}]
                  </span>
                  <span className="truncate">{e.data?.serverName || e.data?.toolName || JSON.stringify(e.data).slice(0, 80)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
