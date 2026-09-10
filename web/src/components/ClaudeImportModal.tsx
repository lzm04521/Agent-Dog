import React, { useEffect, useState } from 'react';
import { X, Download, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { useConfigStore } from '../store/configStore';
import { apiClient } from '../utils/api';

interface PreviewServer {
  name: string;
  transport?: 'stdio' | 'http-sse' | 'streamable-http';
  status: 'new' | 'conflict' | 'invalid';
  reason?: string;
}

interface ImportResult {
  added: Array<{ name: string; transport?: string }>;
  skipped: Array<{ name: string; reason: string }>;
}

const TRANSPORT_LABEL: Record<string, string> = {
  stdio: 'stdio',
  'http-sse': 'SSE',
  'streamable-http': 'HTTP',
};

export const ClaudeImportModal: React.FC = () => {
  const { hideClaudeImport, loadConfig } = useConfigStore();

  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [servers, setServers] = useState<PreviewServer[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);

  const loadPreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const data: any = await apiClient.get('/api/import/claude/preview');
      setSource(data.source || '');
      setServers(data.servers || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const data: any = await apiClient.post('/api/import/claude');
      setResult({ added: data.added || [], skipped: data.skipped || [] });
      // 刷新服务器列表，让新导入的服务器即时出现
      loadConfig();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const willAdd = servers.filter(s => s.status === 'new');
  const willSkip = servers.filter(s => s.status !== 'new');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-base-100 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
        {/* Modal header */}
        <div className="flex items-center justify-between p-6 border-b border-base-300">
          <div>
            <h2 className="text-xl font-bold text-base-content flex items-center gap-2">
              <Download className="h-5 w-5 text-secondary" />
              导入 Claude 的 MCP 服务器
            </h2>
            <p className="text-sm text-base-content/70 mt-1">
              从 Claude Code 的用户配置导入 MCP 服务器到 AgentDog
            </p>
          </div>
          <button onClick={hideClaudeImport} className="btn btn-ghost btn-sm btn-circle">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[70vh]">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-base-content/70">正在读取配置...</span>
            </div>
          ) : error && !result ? (
            <div>
              <div className="alert alert-error">
                <AlertTriangle className="h-5 w-5" />
                <div>
                  <h3 className="font-medium">无法读取 Claude 配置</h3>
                  <p className="text-sm mt-1 break-all">{error}</p>
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <button onClick={loadPreview} className="btn btn-outline btn-sm">
                  重新读取
                </button>
              </div>
            </div>
          ) : result ? (
            <div className="space-y-4">
              <div className="alert alert-success">
                <CheckCircle2 className="h-5 w-5" />
                <div>
                  <h3 className="font-medium">导入完成</h3>
                  <p className="text-sm mt-1">
                    成功导入 <strong>{result.added.length}</strong> 个，跳过{' '}
                    <strong>{result.skipped.length}</strong> 个
                  </p>
                </div>
              </div>

              {result.added.length > 0 && (
                <div>
                  <h4 className="font-medium text-base-content mb-2">已导入</h4>
                  <div className="space-y-1">
                    {result.added.map(item => (
                      <div key={item.name} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-success" />
                        <span className="font-mono">{item.name}</span>
                        {item.transport && (
                          <span className="badge badge-sm badge-outline">{TRANSPORT_LABEL[item.transport] || item.transport}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.skipped.length > 0 && (
                <div>
                  <h4 className="font-medium text-base-content mb-2">跳过（未导入）</h4>
                  <div className="space-y-1">
                    {result.skipped.map(item => (
                      <div key={item.name} className="flex items-center gap-2 text-sm text-base-content/70">
                        <AlertTriangle className="h-4 w-4 text-warning" />
                        <span className="font-mono">{item.name}</span>
                        <span>{item.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {source && (
                <p className="text-sm text-base-content/70 break-all">
                  来源: <span className="font-mono">{source}</span>
                </p>
              )}

              {/* 汇总 */}
              <div className="flex items-center space-x-6 text-sm text-base-content/70">
                <span>
                  将导入: <span className="font-semibold text-success">{willAdd.length}</span> 个
                </span>
                <span>
                  将跳过: <span className="font-semibold text-warning">{willSkip.length}</span> 个
                </span>
              </div>

              {servers.length === 0 ? (
                <div className="text-center py-12 text-base-content/70">
                  <Download className="h-10 w-10 mx-auto mb-3 text-base-content/30" />
                  <p>没有发现可导入的 MCP 服务器</p>
                  <p className="text-sm mt-1">请先在你的 Claude Code 中配置 mcpServers</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {willAdd.length > 0 && (
                    <div>
                      <h4 className="font-medium text-base-content mb-2">将导入</h4>
                      <div className="space-y-1">
                        {willAdd.map(s => (
                          <div key={s.name} className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="h-4 w-4 text-success" />
                            <span className="font-mono">{s.name}</span>
                            {s.transport && (
                              <span className="badge badge-sm badge-outline">{TRANSPORT_LABEL[s.transport] || s.transport}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {willSkip.length > 0 && (
                    <div>
                      <h4 className="font-medium text-base-content mb-2">将跳过</h4>
                      <div className="space-y-1">
                        {willSkip.map(s => (
                          <div key={s.name} className="flex items-center gap-2 text-sm text-base-content/70">
                            <AlertTriangle className="h-4 w-4 text-warning" />
                            <span className="font-mono">{s.name}</span>
                            <span className="text-xs">{s.reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-base-300">
          {error && !result && (
            <span className="text-sm text-error break-all">{error}</span>
          )}
          <span />
          <div className="flex items-center gap-3">
            {result ? (
              <button onClick={hideClaudeImport} className="btn btn-primary btn-sm">
                完成
              </button>
            ) : (
              <>
                <button onClick={hideClaudeImport} className="btn btn-ghost btn-sm">
                  取消
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing || loading || willAdd.length === 0}
                  className="btn btn-primary btn-sm"
                >
                  {importing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      导入中...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      确认导入（{willAdd.length}）
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};