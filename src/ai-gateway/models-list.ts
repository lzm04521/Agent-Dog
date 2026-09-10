// src/ai-gateway/models-list.ts
// /v1/models 双协议模型列表构建：配置快照（设计 P2）——
// enabled 供应商的 models 减 disabledModels（与 model-router 寻址拒绝行为一致），
// id 统一 slug:modelId 可直接填入客户端配置。分页参数不模拟，全量返回。
import { AIProviderConfig } from '../types/index.js';

export interface ModelsListEntry {
  slug: string;
  modelId: string;
}

// created/created_at 无真实数据，用 epoch 占位（必填字段不编造时间）
const EPOCH_ISO = '1970-01-01T00:00:00Z';

export function collectModels(providers: AIProviderConfig[]): ModelsListEntry[] {
  const entries: ModelsListEntry[] = [];
  const enabled = providers.filter(p => p.enabled).sort((a, b) => a.slug.localeCompare(b.slug));
  for (const p of enabled) {
    const disabled = new Set(p.disabledModels || []);
    for (const modelId of p.models || []) {
      if (!disabled.has(modelId)) {
        entries.push({ slug: p.slug, modelId });
      }
    }
  }
  return entries;
}

export function buildAnthropicModelsList(providers: AIProviderConfig[]): any {
  const entries = collectModels(providers);
  const ids = entries.map(e => `${e.slug}:${e.modelId}`);
  return {
    data: entries.map(e => ({
      type: 'model',
      id: `${e.slug}:${e.modelId}`,
      display_name: e.modelId,
      created_at: EPOCH_ISO,
    })),
    first_id: ids[0] ?? null,
    has_more: false,
    last_id: ids[ids.length - 1] ?? null,
  };
}

export function buildOpenAIModelsList(providers: AIProviderConfig[]): any {
  return {
    object: 'list',
    data: collectModels(providers).map(e => ({
      id: `${e.slug}:${e.modelId}`,
      object: 'model',
      created: 0,
      owned_by: e.slug,
    })),
  };
}
