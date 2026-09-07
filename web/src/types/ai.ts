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
  models?: string[];
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
