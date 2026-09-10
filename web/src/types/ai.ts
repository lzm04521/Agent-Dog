// AI 网关前端类型（对应后端 /api/ai-gateway 与 /api/ai-providers）

export type AIDialect = 'openai' | 'anthropic' | 'gemini';

export interface AIProvider {
  id: string;
  slug: string;
  name?: string;
  dialect: AIDialect;
  baseUrl: string;
  apiKey: string; // 列表返回已脱敏（仅末 4 位）
  enabled: boolean;
  models?: string[]; // 已知模型全集（拉取/手工维护，服务端自动入库）
  disabledModels?: string[]; // 取消勾选的模型：网关拒绝对外服务，即时生效
  autoFetchModels?: boolean; // 页面加载时自动拉取上游模型并入库
  headers?: Record<string, string>;
}

export interface GatewayStatus {
  running: boolean;
  enabled: boolean;
  port: number;
  host: string;
  apiKey: string;
}

export interface ProviderTestResult {
  ok: boolean;
  status: number;
  message: string;
  modelCount: number;
}
