import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useConfigStore } from '../store/configStore';

// 全局日志页：聚合实时事件流 + 各服务器日志，按服务器筛选、暂停滚动、清空
// 数据来自 useAppStore（socket 推送），不额外请求后端
export const LogsPage: React.FC = () => {
  const { events, serverLogs } = useAppStore();
  const servers = useConfigStore((s) => s.servers);
  const [serverFilter, setServerFilter] = useState<string>('all');
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  // 统一日志行：事件流与服务器日志合并为单条流（时间倒序展示最新在上）
  const lines = useMemo(() => {
    type Line = { time: string; level: string; tag: string; message: string; server: string };
    const eventLines: Line[] = events.map((e) => ({
      time: new Date(e.timestamp).toLocaleTimeString('zh-CN'),
      level:
        e.type === 'server-error' || e.type === 'error' ? 'err' : e.type === 'server-disconnected' ? 'warn' : 'info',
      tag: e.type,
      message:
        e.data?.serverName
          ? `${e.data.serverName}${e.data?.toolName ? ` · ${e.data.toolName}` : ''}`
          : JSON.stringify(e.data).slice(0, 120),
      server: e.data?.serverName || 'system',
    }));
    const logLines: Line[] = Object.entries(serverLogs).flatMap(([name, logs]) =>
      logs.map((l) => ({
        time: new Date(l.timestamp).toLocaleTimeString('zh-CN'),
        level: l.stream === 'stderr' ? 'err' : 'info',
        tag: l.stream,
        message: l.data.replace(/\n$/, ''),
        server: name,
      }))
    );
    const all = [...eventLines, ...logLines];
    if (serverFilter !== 'all') {
      return all.filter((l) => l.server === serverFilter);
    }
    return all;
  }, [events, serverLogs, serverFilter]);

  useEffect(() => {
    if (autoScroll && !paused && terminalRef.current) {
      terminalRef.current.scrollTop = 0;
    }
  }, [lines, autoScroll, paused]);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-bold">全局日志</h1>
        <span className="text-xs text-base-content/50">实时事件与服务器输出（最近 100 条）</span>
      </div>

      {/* 工具栏：服务器筛选 + 暂停 + 自动滚动 */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="select select-bordered select-sm w-48"
          value={serverFilter}
          onChange={(e) => setServerFilter(e.target.value)}
        >
          <option value="all">全部来源</option>
          {servers.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <button className={`btn btn-sm ${paused ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPaused((p) => !p)}>
          {paused ? '继续刷新' : '暂停刷新'}
        </button>
        <label className="label cursor-pointer gap-2 text-sm text-base-content/60 py-0">
          <input
            type="checkbox"
            className="toggle toggle-sm toggle-primary"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          自动滚动
        </label>
      </div>

      {/* 终端：最新在顶部 */}
      <div
        ref={terminalRef}
        key={paused ? 'paused' : 'live'}
        className="log-terminal min-h-[400px] max-h-[calc(100vh-16rem)] overflow-y-auto scrollbar-thin"
      >
        {lines.length === 0 ? (
          <div className="text-center py-8 opacity-40">暂无日志，等待实时推送…</div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="flex gap-3 whitespace-nowrap">
              <span className="log-time shrink-0">{l.time}</span>
              <span className={`shrink-0 ${l.level === 'err' ? 'log-err' : l.level === 'warn' ? 'log-warn' : l.level === 'ok' ? 'log-ok' : 'log-info'}`}>
                [{l.tag}]
              </span>
              <span className="truncate" title={l.message}>{l.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
