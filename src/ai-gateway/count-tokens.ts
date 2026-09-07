// count_tokens：anthropic 上游直通真值；openai/gemini 上游本地估算（Claude Code 仅用于上下文预算）
import { Request, Response } from 'express';
import { AIProviderConfig } from '../types/index.js';
import { sendUpstream, UpstreamTimeoutError } from './upstream/provider-client.js';
import { anthropicError } from './anthropic-errors.js';
import { trimTrailingSlash, UPSTREAM_HEADER_TIMEOUT_MS } from './passthrough.js';

export async function handleCountTokens(
  req: Request,
  res: Response,
  provider: AIProviderConfig,
  model: string
): Promise<void> {
  if (provider.dialect === 'anthropic') {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': (req.headers['anthropic-version'] as string) || '2023-06-01',
      ...(provider.headers || {}),
    };
    try {
      const upstream = await sendUpstream({
        url: trimTrailingSlash(provider.baseUrl) + '/v1/messages/count_tokens',
        method: 'POST',
        headers,
        body: JSON.stringify({ ...(req.body as object), model }),
        timeoutMs: UPSTREAM_HEADER_TIMEOUT_MS,
      });
      res.status(upstream.status).set('content-type', upstream.headers['content-type'] || 'application/json')
        .send(await upstream.text());
    } catch (error) {
      anthropicError(res, 502, 'api_error', `upstream count_tokens failed: ${(error as Error).message}`);
    }
    return;
  }
  // 本地估算：ASCII 字符 /3.5，CJK 按权重 1（粗估，仅供上下文预算）
  const inputTokens = estimateTokens(JSON.stringify(req.body ?? {}));
  res.json({ input_tokens: inputTokens });
}

export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk + rest / 3.5);
}
