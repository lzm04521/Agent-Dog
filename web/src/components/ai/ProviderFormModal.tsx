import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useProviderStore } from '../../store/providerStore';
import { AIDialect } from '../../types/ai';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

interface FormData {
  slug: string;
  name: string;
  dialect: AIDialect;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  headersText: string; // JSON 文本编辑
}

// 新增/编辑供应商表单：slug 实时校验、apiKey 编辑留空 = 不改、自定义 headers 键值（JSON 编辑）
export const ProviderFormModal: React.FC = () => {
  const { showProviderModal, editingProvider, providers, setShowProviderModal, addProvider, updateProvider } = useProviderStore();
  const editing = !!editingProvider;

  const [form, setForm] = useState<FormData>(() => ({
    slug: editingProvider?.slug || '',
    name: editingProvider?.name || '',
    dialect: editingProvider?.dialect || 'openai',
    baseUrl: editingProvider?.baseUrl || '',
    apiKey: '', // 编辑时不回显完整值，留空 = 不改
    enabled: editingProvider?.enabled ?? true,
    headersText: editingProvider?.headers ? JSON.stringify(editingProvider.headers, null, 2) : '',
  }));
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  if (!showProviderModal) {
    return null;
  }

  const slugTaken = providers.some(p => p.slug === form.slug && p.id !== editingProvider?.id);
  const slugInvalid = form.slug !== '' && !SLUG_PATTERN.test(form.slug);
  const headersInvalid = form.headersText.trim() !== '' && (() => {
    try {
      const parsed = JSON.parse(form.headersText);
      return typeof parsed !== 'object' || parsed === null || Array.isArray(parsed);
    } catch {
      return true;
    }
  })();
  const canSubmit = form.slug && !slugInvalid && !slugTaken && form.baseUrl
    && form.dialect && (!editing || form.apiKey !== undefined)
    && (editing || form.apiKey !== '') && !headersInvalid;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setServerError(null);
    try {
      const headers = form.headersText.trim() ? JSON.parse(form.headersText) : undefined;
      if (editing && editingProvider) {
        await updateProvider(editingProvider.id, {
          slug: form.slug, name: form.name || undefined, dialect: form.dialect,
          baseUrl: form.baseUrl, ...(form.apiKey ? { apiKey: form.apiKey } : {}),
          enabled: form.enabled, ...(headers !== undefined ? { headers } : {}),
        });
      } else {
        await addProvider({
          slug: form.slug, name: form.name || undefined, dialect: form.dialect,
          baseUrl: form.baseUrl, apiKey: form.apiKey, enabled: form.enabled,
          ...(headers !== undefined ? { headers } : {}),
        });
      }
      setShowProviderModal(false);
    } catch (error) {
      setServerError((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">{editing ? '编辑供应商' : '新增供应商'}</h3>
          <button className="btn btn-ghost btn-sm btn-square" onClick={() => setShowProviderModal(false)}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="grid gap-3">
            <div className="form-control">
              <label className="label py-1"><span className="label-text">slug（寻址名，不可与其他重复）</span></label>
              <input
                className={`input input-bordered input-sm font-mono ${slugInvalid || slugTaken ? 'input-error' : form.slug ? 'input-success' : ''}`}
                value={form.slug}
                onChange={e => setForm({ ...form, slug: e.target.value })}
                placeholder="deepseek"
                disabled={false}
              />
              <label className="label py-1">
                <span className="label-text-alt text-error">
                  {slugInvalid ? '格式：小写字母/数字开头，仅 a-z 0-9 -' : slugTaken ? '该 slug 已被占用' : '模型寻址格式：slug:modelId'}
                </span>
              </label>
            </div>
            <div className="form-control">
              <label className="label py-1"><span className="label-text">显示名（可选）</span></label>
              <input className="input input-bordered input-sm" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="深度求索" />
            </div>
            <div className="form-control">
              <label className="label py-1"><span className="label-text">上游方言</span></label>
              <select className="select select-bordered select-sm" value={form.dialect} onChange={e => setForm({ ...form, dialect: e.target.value as AIDialect })}>
                <option value="openai">openai 兼容</option>
                <option value="anthropic">anthropic（直通）</option>
                <option value="gemini">gemini</option>
              </select>
            </div>
            <div className="form-control">
              <label className="label py-1"><span className="label-text">Base URL</span></label>
              <input
                className="input input-bordered input-sm font-mono"
                value={form.baseUrl}
                onChange={e => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com"
              />
            </div>
            <div className="form-control">
              <label className="label py-1"><span className="label-text">API Key {editing && '（留空 = 不修改）'}</span></label>
              <input
                type="password"
                className="input input-bordered input-sm font-mono"
                value={form.apiKey}
                onChange={e => setForm({ ...form, apiKey: e.target.value })}
                placeholder={editing ? '不修改则留空' : 'sk-...'}
              />
            </div>
            <div className="form-control">
              <label className="label py-1"><span className="label-text">自定义请求头（可选，JSON）</span></label>
              <textarea
                className={`textarea textarea-bordered textarea-sm font-mono ${headersInvalid ? 'textarea-error' : ''}`}
                rows={3}
                value={form.headersText}
                onChange={e => setForm({ ...form, headersText: e.target.value })}
                placeholder={'{\n  "x-custom": "value"\n}'}
              />
            </div>
            <label className="label cursor-pointer justify-start gap-3 py-1">
              <input type="checkbox" className="toggle toggle-sm toggle-primary" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />
              <span className="label-text">启用</span>
            </label>
          </div>

          {serverError && <div className="alert alert-error mt-3 py-2 text-sm">{serverError}</div>}

          <div className="modal-action">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowProviderModal(false)}>取消</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!canSubmit || submitting}>
              {submitting ? <span className="loading loading-spinner loading-xs"></span> : editing ? '保存' : '创建'}
            </button>
          </div>
        </form>
      </div>
      <div className="modal-backdrop" onClick={() => setShowProviderModal(false)}></div>
    </div>
  );
};
