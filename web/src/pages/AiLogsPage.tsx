import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { apiClient } from '../utils/api';
import type { AiCallLog } from '../types';

// token 数缩写展示（1234 → 1.2k）
function fmtTokens(n?: number): string {
  if (n === undefined || n === null) return '';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const isFailed = (l: AiCallLog) => l.status >= 400;

// AI 调用日志页：网关转发请求流水（首屏 REST 拉历史 + socket 增量），失败条可展开摘要
export const AiLogsPage: React.FC = () => {
  const { aiLogs, initAiLogs } = useAppStore();
  const [providerFilter, setProviderFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'fail'>('all');
  const [ingressFilter, setIngressFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 首屏恢复 JSONL 落盘历史（最新在前）
  useEffect(() => {
    apiClient
      .get('/api/ai-logs?limit=200')
      .then((rows: AiCallLog[]) => {
        initAiLogs(rows);
      })
      .catch(() => {
        // 历史拉取失败不影响实时流
      });
  }, []);

  const providers = useMemo(() => {
    const set = new Set(aiLogs.map((l) => l.providerName).filter(Boolean));
    return Array.from(set).sort();
  }, [aiLogs]);

  const logs = useMemo(() => {
    return aiLogs.filter((l) => {
      if (providerFilter !== 'all' && l.providerName !== providerFilter) return false;
      if (statusFilter === 'ok' && isFailed(l)) return false;
      if (statusFilter === 'fail' && !isFailed(l)) return false;
      if (ingressFilter !== 'all' && l.ingress !== ingressFilter) return false;
      return true;
    });
  }, [aiLogs, providerFilter, statusFilter, ingressFilter]);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-bold">调用日志</h1>
        <span className="text-xs text-base-content/50">AI 网关转发请求流水（最近 200 条，重启后可恢复历史）</span>
      </div>

      {/* 工具栏：供应商 / 状态 / 方言筛选 + 暂停滚动 */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="select select-bordered select-sm w-44"
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
        >
          <option value="all">全部供应商</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className="select select-bordered select-sm w-32"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'ok' | 'fail')}
        >
          <option value="all">全部状态</option>
          <option value="ok">成功</option>
          <option value="fail">失败</option>
        </select>
        <select
          className="select select-bordered select-sm w-40"
          value={ingressFilter}
          onChange={(e) => setIngressFilter(e.target.value)}
        >
          <option value="all">全部入口</option>
          <option value="anthropic">/anthropic</option>
          <option value="openai">/openai</option>
        </select>
      </div>

      {/* 终端：最新在顶部，失败行点击展开详情 */}
      <div className="log-terminal min-h-[400px] max-h-[calc(100vh-16rem)] overflow-y-auto scrollbar-thin">
        {logs.length === 0 ? (
          <div className="text-center py-8 opacity-40">暂无调用记录，等待请求进入…</div>
        ) : (
          logs.map((l) => {
            const failed = isFailed(l);
            const expanded = expandedId === l.id;
            return (
              <div key={l.id}>
                <div
                  className={`flex gap-3 whitespace-nowrap items-center ${failed ? 'cursor-pointer hover:bg-base-content/5' : ''}`}
                  onClick={failed ? () => setExpandedId(expanded ? null : l.id) : undefined}
                >
                  <span className="log-time shrink-0">{new Date(l.timestamp).toLocaleTimeString('zh-CN')}</span>
                  <span className={`shrink-0 badge badge-xs badge-outline ${l.ingress === 'openai' ? 'badge-info' : 'badge-secondary'}`}>
                    {l.ingress}
                  </span>
                  <span className="shrink-0 log-info">{l.providerName ? `${l.providerName}/${l.upstreamModel}` : l.model || '(未路由)'}</span>
                  <span className={`shrink-0 font-mono ${failed ? 'log-err' : 'log-ok'}`}>{l.status}</span>
                  <span className="shrink-0 log-info">{l.durationMs}ms</span>
                  {(l.usage?.inputTokens !== undefined || l.usage?.outputTokens !== undefined) && (
                    <span className="shrink-0 log-time">
                      ↑{fmtTokens(l.usage?.inputTokens)} ↓{fmtTokens(l.usage?.outputTokens)}
                    </span>
                  )}
                  {failed && (
                    <span className="truncate log-err" title={l.error}>
                      {l.error}
                    </span>
                  )}
                  {failed && <span className="ml-auto shrink-0 log-time">{expanded ? '收起' : '详情'}</span>}
                </div>
                {failed && expanded && (
                  <div className="flex flex-col gap-1 pl-[4.5rem] pr-4 py-1.5 text-xs font-mono whitespace-pre-wrap break-all opacity-80">
                    {l.error && (
                      <div>
                        <span className="log-err">[error]</span> {l.error}
                      </div>
                    )}
                    {l.requestExcerpt && (
                      <div>
                        <span className="log-warn">[request]</span> {l.requestExcerpt}
                      </div>
                    )}
                    {l.responseExcerpt && (
                      <div>
                        <span className="log-warn">[response]</span> {l.responseExcerpt}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
