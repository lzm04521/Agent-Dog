// Anthropic 上游直通通道（fast-path）：请求体仅三处改写——
// 1) model 剥离 slug 前缀；2) 替换认证头；3) 合并 provider 自定义 headers。
// cache_control / thinking / metadata 等原生字段零损耗；流式响应原样 pipe 回传
// （cache_creation_input_tokens 等计费字段完整保留）。
import { Request, Response } from 'express';
import { AIProviderConfig } from '../types/index.js';
import { sendUpstream } from './upstream/provider-client.js';
import { anthropicError, mapUpstreamStatus } from './anthropic-errors.js';

export const UPSTREAM_HEADER_TIMEOUT_MS = 30_000;
export const STREAM_WATCHDOG_MS = 5 * 60_000;

export async function passthroughMessages(
  req: Request,
  res: Response,
  provider: AIProviderConfig,
  model: string
): Promise<void> {
  const body = { ...(req.body as Record<string, unknown>), model };

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': provider.apiKey,
    'anthropic-version': (req.headers['anthropic-version'] as string) || '2023-06-01',
    ...(provider.headers || {}),
  };
  if (req.headers['anthropic-beta']) {
    headers['anthropic-beta'] = req.headers['anthropic-beta'] as string;
  }

  const abort = new AbortController();
  res.on('close', () => abort.abort());

  const url = trimTrailingSlash(provider.baseUrl) + '/v1/messages';

  let upstream;
  try {
    upstream = await sendUpstream({
      url,
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      timeoutMs: UPSTREAM_HEADER_TIMEOUT_MS,
      signal: abort.signal,
    });
  } catch (error) {
    if (abort.signal.aborted) {
      return; // 客户端已断连
    }
    const message = (error as Error).message;
    const isTimeout = /timeout/i.test(message);
    anthropicError(
      res,
      isTimeout ? 504 : 502,
      'api_error',
      `upstream request failed: ${message}`
    );
    return;
  }

  // 直通通道例外：上游响应头一到即转发（含错误响应，格式原生一致）
  const contentType = upstream.headers['content-type'] || '';

  if (!contentType.includes('text/event-stream')) {
    const text = await upstream.text();
    if (res.writableEnded) {
      return;
    }
    res.status(upstream.status).set('content-type', contentType || 'application/json').send(text);
    return;
  }

  // 流式：SSE 原样 pipe 回传 + 无字节 watchdog
  res.status(200).set({
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  let lastByteAt = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - lastByteAt > STREAM_WATCHDOG_MS) {
      clearInterval(watchdog);
      res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'upstream stream stalled' } })}\n\n`);
      res.end();
      abort.abort();
    }
  }, 30_000);

  try {
    await upstream.stream(line => {
      lastByteAt = Date.now();
      res.write(line + '\n');
    });
  } finally {
    clearInterval(watchdog);
    if (!res.writableEnded) {
      res.end();
    }
  }
}

export function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

export { mapUpstreamStatus };
