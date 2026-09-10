import React, { useState } from 'react';
import { Download, Plus, RefreshCw, X } from 'lucide-react';
import { useProviderStore } from '../../store/providerStore';
import { AIProvider } from '../../types/ai';

interface ModelsSectionProps {
  provider: AIProvider;
}

// 单供应商模型管理（简化版）：
// - 拉取上游模型即入库（服务端持久化，新增模型默认勾选）
// - 每个模型一个开关：取消勾选 = 网关拒绝对外服务，即时生效，无需保存
// - 手工添加/删除模型（拉取失败时兜底）
export const ModelsSection: React.FC<ModelsSectionProps> = ({ provider }) => {
  const { fetchModels, updateProvider } = useProviderStore();
  const [fetching, setFetching] = useState(false);
  const [updatingModel, setUpdatingModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newModel, setNewModel] = useState('');

  const configured = provider.models || [];
  const disabledSet = new Set(provider.disabledModels || []);

  const doFetch = async () => {
    setFetching(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fetchModels(provider.id);
      const added = configured.filter(m => !result.includes(m)).length;
      setNotice(added > 0 ? `已拉取并入库（新增 ${added} 个模型）` : '已拉取，与现有列表一致');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFetching(false);
    }
  };

  // 勾选/取消勾选：即时写回 disabledModels，网关下一请求即生效
  const toggleModel = async (m: string, enable: boolean) => {
    setUpdatingModel(m);
    setError(null);
    try {
      const next = new Set(disabledSet);
      if (enable) {
        next.delete(m);
      } else {
        next.add(m);
      }
      await updateProvider(provider.id, { disabledModels: [...next] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUpdatingModel(null);
    }
  };

  const addModel = async () => {
    const name = newModel.trim();
    if (!name || configured.includes(name)) {
      return;
    }
    setUpdatingModel(name);
    setError(null);
    try {
      await updateProvider(provider.id, { models: [...configured, name] });
      setNewModel('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUpdatingModel(null);
    }
  };

  const removeModel = async (name: string) => {
    setUpdatingModel(name);
    setError(null);
    try {
      await updateProvider(provider.id, {
        models: configured.filter(m => m !== name),
        disabledModels: (provider.disabledModels || []).filter(m => m !== name),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUpdatingModel(null);
    }
  };

  const enabledCount = configured.filter(m => !disabledSet.has(m)).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          模型管理
          <span className="text-xs font-normal text-base-content/50">
            共 {configured.length} 个 · {enabledCount} 个对外可用
          </span>
        </h3>
        <button className="btn btn-outline btn-xs rounded-field" onClick={doFetch} disabled={fetching}>
          {fetching ? (
            <span className="loading loading-spinner loading-xs"></span>
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          拉取上游模型
        </button>
      </div>

      <p className="text-xs text-base-content/45">
        取消勾选即对外部接口隐藏该模型（即时生效，无需保存）；拉取的新模型默认勾选并自动保存。
      </p>

      {error && <div className="alert alert-error py-2 text-sm">{error}</div>}
      {notice && <div className="text-xs text-success">{notice}</div>}

      {/* 已知模型列表：逐个开关 */}
      <div className="rounded-field border border-base-300/70 divide-y divide-base-300/60">
        {configured.length === 0 ? (
          <div className="p-3 text-sm text-base-content/50 flex items-center gap-2">
            <Download className="w-4 h-4 shrink-0" />
            暂无模型。点击右上「拉取上游模型」自动获取，或在下方手工添加。
          </div>
        ) : (
          configured.map(m => {
            const enabled = !disabledSet.has(m);
            return (
              <div key={m} className="flex items-center gap-3 px-3 py-2 hover:bg-base-200/40">
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-xs"
                  checked={enabled}
                  disabled={updatingModel === m}
                  onChange={e => toggleModel(m, e.target.checked)}
                  title={enabled ? '取消勾选：对外部接口隐藏' : '勾选：对外部接口可用'}
                />
                <span className={`text-sm font-mono truncate flex-1 ${enabled ? '' : 'text-base-content/40 line-through'}`}>
                  {m}
                </span>
                <button
                  className="btn btn-ghost btn-xs btn-square text-base-content/40 hover:text-error shrink-0"
                  onClick={() => removeModel(m)}
                  disabled={updatingModel === m}
                  title={`从列表删除 ${m}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* 手工添加（拉取失败时兜底） */}
      <div className="join w-full">
        <input
          className="input input-bordered input-sm join-item flex-1 w-full font-mono"
          value={newModel}
          onChange={e => setNewModel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addModel()}
          placeholder="手工添加模型 Id（拉取失败时可作兜底）"
        />
        <button className="btn btn-sm btn-primary join-item" onClick={addModel} disabled={!newModel.trim() || updatingModel !== null} title="添加模型">
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
