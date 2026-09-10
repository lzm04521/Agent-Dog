// AI 网关模型寻址：按 "slug:modelId" 第一个冒号分割
// 前段必须命中已启用 provider 的 slug，后段为上游真实模型名原样透传
import { AIProviderConfig } from '../types/index.js';

export interface ResolvedModel {
  provider: AIProviderConfig;
  model: string; // 已剥离 slug 前缀
}

export class ModelRouteError extends Error {
  availableSlugs: string[];
  constructor(message: string, availableSlugs: string[]) {
    super(message);
    this.name = 'ModelRouteError';
    this.availableSlugs = availableSlugs;
  }
}

export function resolveModel(model: string, providers: AIProviderConfig[]): ResolvedModel {
  const enabled = providers.filter(p => p.enabled);
  const availableSlugs = enabled.map(p => p.slug);

  const colonIndex = model.indexOf(':');
  if (!model || colonIndex === -1) {
    throw new ModelRouteError(
      `invalid model "${model}": expected format "slug:modelId" (e.g. "deepseek:deepseek-chat")`,
      availableSlugs
    );
  }

  const slug = model.slice(0, colonIndex);
  const realModel = model.slice(colonIndex + 1);
  const provider = enabled.find(p => p.slug === slug);
  if (!provider) {
    throw new ModelRouteError(
      `Unknown provider slug "${slug}", available: ${availableSlugs.join(', ') || '(none)'}`,
      availableSlugs
    );
  }
  if (!realModel) {
    throw new ModelRouteError(`invalid model "${model}": empty model id after slug`, availableSlugs);
  }
  if (provider.disabledModels?.includes(realModel)) {
    throw new ModelRouteError(
      `model "${model}" is disabled for provider "${slug}" (unchecked in model management)`,
      availableSlugs
    );
  }
  return { provider, model: realModel };
}
