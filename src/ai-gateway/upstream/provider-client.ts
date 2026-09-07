// 上游 HTTP 客户端：原生 fetch + 增量 SSE 逐行解析
// （流式解析先例见 src/adapters/streamable-http-adapter.ts handleSSEResponse，此处改为真正的增量逐行）
export interface UpstreamRequest {
  url: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number; // 响应头超时
  signal?: AbortSignal; // 外部 abort（客户端断连）
}

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string>;
  text(): Promise<string>; // 非流式：读全量
  stream(onLine: (line: string) => void): Promise<void>; // SSE：逐行回调，流结束 resolve
}

export class UpstreamTimeoutError extends Error {
  constructor(url: string) {
    super(`upstream timeout: no response headers within limit from ${url}`);
    this.name = 'UpstreamTimeoutError';
  }
}

export async function sendUpstream(req: UpstreamRequest): Promise<UpstreamResponse> {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), req.timeoutMs);
  // 外部 abort 联动
  const onExternalAbort = () => timeoutController.abort();
  req.signal?.addEventListener('abort', onExternalAbort, { once: true });

  let response: globalThis.Response;
  try {
    response = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: timeoutController.signal,
    });
  } catch (error) {
    // 区分超时 abort 与外部 abort
    if (timeoutController.signal.aborted && !req.signal?.aborted) {
      throw new UpstreamTimeoutError(req.url);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onExternalAbort);
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });

  return {
    status: response.status,
    headers,
    text: () => response.text(),
    stream: async (onLine: (line: string) => void) => {
      if (!response.body) {
        return;
      }
      // 响应头已到，后续流读取不再受 timeoutMs 约束（无字节 watchdog 由调用方实现）
      await parseSSEStream(response.body as ReadableStream<Uint8Array>, onLine);
    },
  };
}

// 增量逐行解析：按 \n 分行缓冲，跨 chunk 行不撕裂
export async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  onLine: (line: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        onLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      onLine(buffer.replace(/\r$/, ''));
    }
  } finally {
    reader.releaseLock();
  }
}
