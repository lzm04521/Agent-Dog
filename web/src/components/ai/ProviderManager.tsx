import React, { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, PlugZap, Sparkles } from 'lucide-react';
import { useProviderStore } from '../../store/providerStore';
import { GatewaySettings } from './GatewaySettings';
import { ProviderFormModal } from './ProviderFormModal';
import { ModelsSection } from './ModelsSection';
import { AIProvider } from '../../types/ai';

const DIALECT_BADGE: Record<string, string> = {
  openai: 'badge-info',
  anthropic: 'badge-secondary',
  gemini: 'badge-success',
};

// AI 供应商维护界面主入口：上状态（网关设置）+ 左供应商列表 + 右详情（含模型管理）
export const ProviderManager: React.FC = () => {
  const {
    providers, loading, error, testingId, selectedProviderId,
    loadAll, toggleProvider, removeProvider, testProvider,
    setShowProviderModal, setSelectedProvider,
  } = useProviderStore();
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const autoFetchedRef = useRef(false);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 加载后对"启用 + 自动拉取"的供应商静默拉取一次上游模型（服务端入库，新增默认勾选）
  useEffect(() => {
    if (autoFetchedRef.current || providers.length === 0) {
      return;
    }
    autoFetchedRef.current = true;
    for (const p of providers) {
      if (p.enabled && p.autoFetchModels) {
        useProviderStore.getState().fetchModels(p.id).catch(() => {
          // 静默失败：不打扰用户，可稍后手动拉取
        });
      }
    }
  }, [providers]);

  // 列表加载后默认选中第一个；选中的被删后回退
  useEffect(() => {
    if (providers.length === 0) {
      if (selectedProviderId) setSelectedProvider(null);
      return;
    }
    if (!selectedProviderId || !providers.find(p => p.id === selectedProviderId)) {
      setSelectedProvider(providers[0].id);
    }
  }, [providers, selectedProviderId, setSelectedProvider]);

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

  const selected = providers.find(p => p.id === selectedProviderId) || null;
  const enabledCount = providers.filter(p => p.enabled).length;

  return (
    <div className="flex flex-col gap-4">
      {/* 顶部状态条：统计 + 网关设置（单卡片两行紧凑布局） */}
      <div className="bg-base-100 border border-base-300 rounded-box shadow-sm px-4 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap pb-2.5 border-b border-base-300/70">
          <h1 className="text-base font-semibold flex items-center gap-3 flex-wrap">
            供应商
            <span className="text-sm font-normal text-base-content/50">
              共 {providers.length} 个 · <span className="text-accent font-medium">{enabledCount}</span> 个已启用
            </span>
          </h1>
          <button className="btn btn-primary btn-sm rounded-field" onClick={() => setShowProviderModal(true)}>
            <Plus className="w-4 h-4" /> 新增供应商
          </button>
        </div>
        <GatewaySettings />
      </div>

      {/* 主区域：左列表 + 右详情，内容自适应高度 */}
      <div className="flex items-start bg-base-100 border border-base-300 rounded-box shadow-sm overflow-hidden">
        {/* 左侧供应商列表 */}
        <div className="w-72 shrink-0 border-r border-base-300 flex flex-col self-stretch">
          <div className="px-3 py-2.5 border-b border-base-300 text-sm font-medium text-base-content/70">
            供应商列表
          </div>
          <div className="p-2 max-h-[30rem] overflow-y-auto">
            {providers.length === 0 ? (
              <div className="p-6 text-center text-base-content/70">
                <Sparkles className="h-12 w-12 mx-auto mb-4 text-base-content/40" />
                <p className="mb-2">还没有配置供应商</p>
                <p className="text-sm mb-4">新增后客户端通过 <code className="font-mono">slug:modelId</code> 访问任意上游</p>
                <button className="btn btn-primary btn-sm" onClick={() => setShowProviderModal(true)}>
                  新增供应商
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {providers.map(p => {
                  const active = p.id === selectedProviderId;
                  const test = testResults[p.id];
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProvider(p.id)}
                      className={`w-full text-left px-3 py-2 rounded-field border transition-all ${
                        active
                          ? 'bg-primary/10 border-primary/40'
                          : 'border-transparent hover:bg-base-200/60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.enabled ? 'bg-success' : 'bg-base-content/25'}`}
                          title={p.enabled ? '已启用' : '已禁用'}
                        />
                        <span className={`font-mono font-medium text-sm truncate ${active ? 'text-primary' : ''}`}>{p.slug}</span>
                        <span className={`badge ${DIALECT_BADGE[p.dialect] || 'badge-ghost'} badge-xs ml-auto shrink-0`}>{p.dialect}</span>
                      </div>
                      {p.name && <div className="text-xs text-base-content/55 mt-1 truncate pl-3.5">{p.name}</div>}
                      <div className="text-xs text-base-content/45 mt-1 pl-3.5 flex items-center gap-1.5 min-w-0">
                        <span className="shrink-0">{p.models?.length || 0} 模型</span>
                        {test && (
                          <span className={`truncate ${test.ok ? 'text-success' : 'text-error'}`} title={test.message}>
                            {test.ok ? '✓' : '✕'} {test.message}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右侧详情面板 */}
        <div className="flex-1 min-w-0">
          {selected ? (
            <div className="p-5 space-y-5">
              {/* 供应商信息卡片：头像 + 基本信息 + 操作 */}
              <div className="flex items-start gap-4 flex-wrap">
                <div className="w-11 h-11 rounded-field bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-content font-bold text-lg font-mono shrink-0 shadow-md">
                  {selected.slug.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-bold font-mono">{selected.slug}</span>
                    <span className={`badge ${DIALECT_BADGE[selected.dialect] || 'badge-ghost'} badge-sm`}>{selected.dialect}</span>
                    {selected.enabled ? (
                      <span className="badge badge-success badge-outline badge-sm">已启用</span>
                    ) : (
                      <span className="badge badge-ghost badge-sm">已禁用</span>
                    )}
                  </div>
                  {selected.name && <div className="text-sm text-base-content/60 mt-1">{selected.name}</div>}
                  <div className="text-xs font-mono text-base-content/45 mt-1.5 truncate" title={selected.baseUrl}>
                    {selected.baseUrl}
                  </div>
                  <div className="text-xs font-mono text-base-content/40 mt-0.5 truncate" title={selected.apiKey}>
                    key {selected.apiKey}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="flex items-center gap-2 cursor-pointer pr-3 mr-1 border-r border-base-300" title="启用/禁用">
                    <input
                      type="checkbox"
                      className="toggle toggle-primary toggle-sm"
                      checked={selected.enabled}
                      onChange={e => toggleProvider(selected.id, e.target.checked)}
                    />
                  </label>
                  <button className="btn btn-outline btn-sm rounded-field" onClick={() => doTest(selected)} disabled={testingId === selected.id}>
                    {testingId === selected.id ? <span className="loading loading-spinner loading-xs"></span> : <PlugZap className="w-4 h-4" />} 测试
                  </button>
                  <button className="btn btn-outline btn-sm rounded-field" onClick={() => setShowProviderModal(true, selected)}>
                    <Pencil className="w-4 h-4" /> 编辑
                  </button>
                  <button className="btn btn-outline btn-sm btn-error rounded-field" onClick={() => doDelete(selected)}>
                    <Trash2 className="w-4 h-4" /> 删除
                  </button>
                </div>
              </div>

              {testResults[selected.id] && (
                <div className={`text-xs ${testResults[selected.id].ok ? 'text-success' : 'text-error'}`}>
                  {testResults[selected.id].ok ? '✓ ' : '✕ '}{testResults[selected.id].message}
                </div>
              )}

              <div className="border-t border-base-300 pt-4">
                <ModelsSection provider={selected} />
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-base-content/70">
              <Sparkles className="h-16 w-16 mx-auto mb-4 text-base-content/40" />
              <h3 className="text-lg font-medium mb-2">选择一个供应商</h3>
              <p className="text-sm">从左侧列表选择一个供应商来查看和管理其模型</p>
            </div>
          )}
        </div>
      </div>

      <ProviderFormModal />
    </div>
  );
};
