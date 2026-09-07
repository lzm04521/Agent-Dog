// 按方言拉取上游模型列表 + 各方言 URL 构造（Task 8/10 复用）
import { AIProviderConfig } from '../../types/index.js';
import { sendUpstream } from './provider-client.js';

function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

// openai 兼容：baseUrl 末尾已含 /v1 则直接拼，否则补 /v1
function openaiBase(baseUrl: string): string {
  const base = trimSlash(baseUrl);
  return /\/v\d+$/.test(base) ? base : base + '/v1';
}

export function openaiChatUrl(baseUrl: string): string {
  return openaiBase(baseUrl) + '/chat/completions';
}

export function openaiModelsUrl(baseUrl: string): string {
  return openaiBase(baseUrl) + '/models';
}

export function anthropicMessagesUrl(baseUrl: string): string {
  return trimSlash(baseUrl) + '/v1/messages';
}

export function geminiGenerateUrl(baseUrl: string, model: string, stream: boolean): string {
  const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  return `${trimSlash(baseUrl)}/v1beta/models/${encodeURIComponent(model)}:${action}`;
}

export function geminiModelsUrl(baseUrl: string): string {
  return `${trimSlash(baseUrl)}/v1beta/models`;
}

export async function listUpstreamModels(provider: AIProviderConfig): Promise<{ ok: boolean; status: number; models: string[]; message: string }> {
  try {
    let url: string;
    let headers: Record<string, string>;
    if (provider.dialect === 'openai') {
      url = openaiModelsUrl(provider.baseUrl);
      headers = { authorization: `Bearer ${provider.apiKey}`, ...(provider.headers || {}) };
    } else if (provider.dialect === 'anthropic') {
      url = `${trimSlash(provider.baseUrl)}/v1/models`;
      headers = { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01', ...(provider.headers || {}) };
    } else {
      url = geminiModelsUrl(provider.baseUrl);
      headers = { 'x-goog-api-key': provider.apiKey, ...(provider.headers || {}) };
    }

    const resp = await sendUpstream({ url, method: 'GET', headers, timeoutMs: 15_000 });
    const text = await resp.text();
    if (resp.status !== 200) {
      return { ok: false, status: resp.status, models: [], message: text.slice(0, 500) };
    }
    const json = JSON.parse(text);
    let models: string[] = [];
    if (Array.isArray(json.data)) {
      models = json.data.map((m: any) => m.id).filter(Boolean);        // openai
    } else if (Array.isArray(json.models)) {
      models = json.models.map((m: any) => (m.name || '').replace(/^models\//, '')).filter(Boolean); // gemini
    }
    return { ok: true, status: 200, models, message: 'ok' };
  } catch (error) {
    return { ok: false, status: 0, models: [], message: (error as Error).message };
  }
}
