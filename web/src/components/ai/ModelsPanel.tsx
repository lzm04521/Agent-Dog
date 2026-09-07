import React, { useEffect, useState } from 'react';
import { X, Download, Plus, Trash2 } from 'lucide-react';
import { useProviderStore } from '../../store/providerStore';

// 单供应商模型管理：拉取上游列表（可选写回）、手工添加、删除
export const ModelsPanel: React.FC = () => {
  const {
    providers, modelsPanelProviderId, setModelsPanelProvider,
    fetchModels, updateProvider,
  } = useProviderStore();
  const [fetched, setFetched] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newModel, setNewModel] = useState('');

  const provider = providers.find(p => p.id === modelsPanelProviderId);

  useEffect(() => {
    setFetched(null);
    setError(null);
  }, [modelsPanelProviderId]);

  if (!modelsPanelProviderId || !provider) {
    return null;
  }

  const doFetch = async () => {
    setFetching(true);
    setError(null);
    try {
      setFetched(await fetchModels(provider.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFetching(false);
    }
  };

  const writeBack = async (models: string[]) => {
    await updateProvider(provider.id, { models });
  };

  const addModel = async () => {
    const name = newModel.trim();
    if (!name || provider.models?.includes(name)) {
      return;
    }
    await writeBack([...(provider.models || []), name]);
    setNewModel('');
  };

  const removeModel = async (name: string) => {
    await writeBack((provider.models || []).filter(m => m !== name));
  };

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-lg">模型管理</h3>
            <p className="text-sm text-base-content/60">{provider.name || provider.slug}（{provider.slug}）</p>
          </div>
          <button className="btn btn-ghost btn-sm btn-square" onClick={() => setModelsPanelProvider(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button className="btn btn-outline btn-sm" onClick={doFetch} disabled={fetching}>
            {fetching ? <span className="loading loading-spinner loading-xs"></span> : <Download className="w-4 h-4" />}
            拉取上游模型
          </button>
          {fetched && fetched.length > 0 && (
            <button className="btn btn-primary btn-sm" onClick={() => writeBack(fetched)}>
              写回（{fetched.length} 个）
            </button>
          )}
        </div>

        {error && <div className="alert alert-error py-2 text-sm mb-3">{error}</div>}

        {fetched && (
          <div className="mb-4">
            <div className="text-sm font-medium mb-1">上游列表（{fetched.length}）</div>
            <div className="max-h-32 overflow-y-auto rounded border border-base-300/50 bg-base-200/40 p-2 text-xs font-mono">
              {fetched.map(m => <div key={m} className="py-0.5">{m}</div>)}
            </div>
          </div>
        )}

        <div className="text-sm font-medium mb-1">已声明模型（{provider.models?.length || 0}）</div>
        <div className="flex gap-2 mb-3">
          <input
            className="input input-bordered input-sm flex-1 font-mono"
            value={newModel}
            onChange={e => setNewModel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addModel()}
            placeholder="手工添加模型 Id"
          />
          <button className="btn btn-sm btn-primary" onClick={addModel} disabled={!newModel.trim()}>
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-40 overflow-y-auto">
          {(provider.models || []).length === 0 && (
            <p className="text-sm text-base-content/50">暂无。拉取失败时手工声明可作兜底。</p>
          )}
          {(provider.models || []).map(m => (
            <div key={m} className="flex items-center justify-between rounded px-2 py-1 hover:bg-base-200/60">
              <span className="text-sm font-mono">{m}</span>
              <button className="btn btn-ghost btn-xs text-error" onClick={() => removeModel(m)}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="modal-backdrop" onClick={() => setModelsPanelProvider(null)}></div>
    </div>
  );
};
