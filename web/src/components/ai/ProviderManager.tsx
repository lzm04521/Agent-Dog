import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, PlugZap, ListTree } from 'lucide-react';
import { useProviderStore } from '../../store/providerStore';
import { GatewaySettings } from './GatewaySettings';
import { ProviderFormModal } from './ProviderFormModal';
import { ModelsPanel } from './ModelsPanel';
import { AIProvider } from '../../types/ai';

const DIALECT_BADGE: Record<string, string> = {
  openai: 'badge-info',
  anthropic: 'badge-secondary',
  gemini: 'badge-success',
};

// AI 供应商维护界面主入口
export const ProviderManager: React.FC = () => {
  const {
    providers, loading, error, testingId,
    loadAll, toggleProvider, removeProvider, testProvider,
    setShowProviderModal, setModelsPanelProvider,
  } = useProviderStore();
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (loading && providers.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="loading loading-spinner loading-lg text-primary"></span>
      </div>
    );
  }

  if (error && providers.length === 0) {
    return <div className="alert alert-error">加载失败：{error}</div>;
  }

  const doTest = async (p: AIProvider) => {
    try {
      const result = await testProvider(p.id);
      setTestResults(prev => ({ ...prev, [p.id]: { ok: result.ok, message: result.ok ? `连通（${result.modelCount} 个模型）` : result.message } }));
    } catch (e) {
      setTestResults(prev => ({ ...prev, [p.id]: { ok: false, message: (e as Error).message } }));
    }
  };

  const doDelete = async (p: AIProvider) => {
    if (window.confirm(`确认删除供应商 ${p.name || p.slug}？`)) {
      await removeProvider(p.id);
    }
  };

  return (
    <div className="space-y-4">
      {/* 页面头：标题 + 数量 + 新增入口 */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold">AI 供应商</h1>
        <span className="badge badge-ghost badge-sm">{providers.length}</span>
        <span className="hidden sm:block text-xs text-base-content/50">
          Claude Code 等客户端经网关以 slug:modelId 寻址访问任意上游
        </span>
        <button className="btn btn-primary btn-sm ml-auto" onClick={() => setShowProviderModal(true)}>
          <Plus className="w-4 h-4" /> 新增供应商
        </button>
      </div>

      <GatewaySettings />

      {providers.length === 0 && (
        <div className="alert">
          <span className="text-sm">暂无供应商。新增后客户端通过 <code className="font-mono">slug:modelId</code> 寻址访问任意上游。</span>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {providers.map(p => {
          const test = testResults[p.id];
          return (
            <div key={p.id} className={`card bg-base-100 shadow-sm border ${p.enabled ? 'border-base-300' : 'border-base-300/60 opacity-70'}`}>
              <div className="card-body p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-medium">{p.slug}</span>
                      {p.name && <span className="text-sm text-base-content/60">{p.name}</span>}
                      <span className={`badge ${DIALECT_BADGE[p.dialect] || 'badge-ghost'} badge-sm`}>{p.dialect}</span>
                      {!p.enabled && <span className="badge badge-ghost badge-sm">已禁用</span>}
                    </div>
                    <div className="text-xs font-mono text-base-content/50 mt-1 truncate" title={p.baseUrl}>{p.baseUrl}</div>
                    <div className="text-xs text-base-content/50 mt-0.5">
                      模型 {p.models?.length || 0} · key {p.apiKey}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="toggle toggle-primary toggle-sm"
                    checked={p.enabled}
                    onChange={e => toggleProvider(p.id, e.target.checked)}
                  />
                </div>

                {test && (
                  <div className={`text-xs mt-1 ${test.ok ? 'text-success' : 'text-error'} truncate`} title={test.message}>
                    {test.ok ? '✓ ' : '✕ '}{test.message}
                  </div>
                )}

                <div className="card-actions justify-end mt-2">
                  <button className="btn btn-ghost btn-xs" onClick={() => setModelsPanelProvider(p.id)} title="模型管理">
                    <ListTree className="w-3.5 h-3.5" /> 模型
                  </button>
                  <button className="btn btn-ghost btn-xs" onClick={() => doTest(p)} disabled={testingId === p.id} title="连通性测试">
                    {testingId === p.id ? <span className="loading loading-spinner loading-xs"></span> : <PlugZap className="w-3.5 h-3.5" />} 测试
                  </button>
                  <button className="btn btn-ghost btn-xs" onClick={() => setShowProviderModal(true, p)} title="编辑">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button className="btn btn-ghost btn-xs text-error" onClick={() => doDelete(p)} title="删除">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ProviderFormModal />
      <ModelsPanel />
    </div>
  );
};
