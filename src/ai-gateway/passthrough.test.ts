import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock 上游客户端
vi.mock('./upstream/provider-client.js', () => ({
  sendUpstream: vi.fn(),
}));
import { sendUpstream } from './upstream/provider-client.js';
import { passthroughMessages, passthroughOpenAI } from './passthrough.js';
import { AIProviderConfig } from '../types/index.js';

const provider: AIProviderConfig = {
  id: '1', slug: 'anthropic-official', dialect: 'anthropic',
  baseUrl: 'https://api.anthropic.com', apiKey: 'sk-upstream', enabled: true,
};

function mockReqRes(body: any, headers: Record<string, string> = {}) {
  const writes: string[] = [];
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    writableEnded: false,
    sentText: undefined as string | undefined,
    on: vi.fn(),
    status(c: number) { this.statusCode = c; return this; },
    set(h: any) { Object.assign(this.headers, h); return this; },
    send(t: string) { this.sentText = t; this.writableEnded = true; return this; },
    json(b: any) { this.sentText = JSON.stringify(b); this.writableEnded = true; return this; },
    write(chunk: string) { writes.push(chunk); return true; },
    end() { this.writableEnded = true; return this; },
  };
  return { req: { body, headers } as any, res, writes };
}

beforeEach(() => {
  vi.mocked(sendUpstream).mockReset();
});

describe('passthroughMessages', () => {
  it('转发 body 剥离 slug 前缀、保留未知原生字段、带上游认证头', async () => {
    vi.mocked(sendUpstream).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      text: async () => '{"id":"msg_1"}',
      stream: async () => {},
    } as any);
    const { req, res } = mockReqRes({
      model: 'anthropic-official:claude-sonnet-4',
      max_tokens: 100,
      thinking: { type: 'enabled', budget_tokens: 50 },
      metadata: { user_id: 'u1' },
    }, { 'anthropic-version': '2023-06-01' });

    await passthroughMessages(req, res, provider, 'claude-sonnet-4');

    const call = vi.mocked(sendUpstream).mock.calls[0]!;
    expect(call[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(call[0].headers['x-api-key']).toBe('sk-upstream');
    const sentBody = JSON.parse(call[0].body!);
    expect(sentBody.model).toBe('claude-sonnet-4');
    expect(sentBody.thinking).toEqual({ type: 'enabled', budget_tokens: 50 });
    expect(sentBody.metadata).toEqual({ user_id: 'u1' });
    expect(res.statusCode).toBe(200);
    expect(res.sentText).toBe('{"id":"msg_1"}');
  });

  it('上游 401 原样透传状态码与响应体', async () => {
    vi.mocked(sendUpstream).mockResolvedValue({
      status: 401,
      headers: { 'content-type': 'application/json' },
      text: async () => '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      stream: async () => {},
    } as any);
    const { req, res } = mockReqRes({ model: 'x:y', max_tokens: 1 });

    await passthroughMessages(req, res, provider, 'claude-sonnet-4');

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.sentText!).error.message).toBe('invalid x-api-key');
  });

  it('流式响应原样 pipe 回传 SSE 行', async () => {
    const sseLines = ['event: message_start', 'data: {"type":"message_start"}', '', 'event: message_stop', ''];
    vi.mocked(sendUpstream).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      text: async () => { throw new Error('not called'); },
      stream: async (onLine: (l: string) => void) => { sseLines.forEach(onLine); },
    } as any);
    const { req, res, writes } = mockReqRes({ model: 'x:y', stream: true, max_tokens: 1 });

    await passthroughMessages(req, res, provider, 'claude-sonnet-4');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(writes.join('')).toBe(sseLines.map(l => l + '\n').join(''));
    expect(res.writableEnded).toBe(true);
  });

  it('baseUrl 带尾斜杠不产生双斜杠', async () => {
    vi.mocked(sendUpstream).mockResolvedValue({
      status: 200, headers: {}, text: async () => '{}', stream: async () => {},
    } as any);
    const { req, res } = mockReqRes({ model: 'x:y', max_tokens: 1 });
    await passthroughMessages(req, res, { ...provider, baseUrl: 'https://api.anthropic.com/' }, 'm');
    expect(vi.mocked(sendUpstream).mock.calls[0]![0].url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('上游连接失败返回 502 Anthropic 错误体', async () => {
    vi.mocked(sendUpstream).mockRejectedValue(new Error('ECONNREFUSED'));
    const { req, res } = mockReqRes({ model: 'x:y', max_tokens: 1 });
    await passthroughMessages(req, res, provider, 'm');
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.sentText!).error.message).toContain('ECONNREFUSED');
  });

  it('provider 自定义 headers 合并进上游请求', async () => {
    vi.mocked(sendUpstream).mockResolvedValue({
      status: 200, headers: {}, text: async () => '{}', stream: async () => {},
    } as any);
    const { req, res } = mockReqRes({ model: 'x:y', max_tokens: 1 });
    await passthroughMessages(req, res, { ...provider, headers: { 'x-custom': 'v' } }, 'm');
    expect(vi.mocked(sendUpstream).mock.calls[0]![0].headers['x-custom']).toBe('v');
  });
});

const oaProvider: AIProviderConfig = {
  id: '2', slug: 'deepseek', dialect: 'openai',
  baseUrl: 'https://api.deepseek.com', apiKey: 'sk-upstream', enabled: true,
};

describe('passthroughOpenAI', () => {
  it('转发 body 剥离 slug、Bearer 认证头、URL 为 /v1/chat/completions、保留原生字段', async () => {
    vi.mocked(sendUpstream).mockResolvedValue({
      status: 200, headers: { 'content-type': 'application/json' },
      text: async () => '{"id":"c1"}', stream: async () => {},
    } as any);
    const { req, res } = mockReqRes({
      model: 'deepseek:deepseek-chat',
      reasoning_effort: 'high',
      response_format: { type: 'json_object' },
    });
    await passthroughOpenAI(req, res, oaProvider, 'deepseek-chat');
    const call = vi.mocked(sendUpstream).mock.calls[0]!;
    expect(call[0].url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(call[0].headers['authorization']).toBe('Bearer sk-upstream');
    const sentBody = JSON.parse(call[0].body!);
    expect(sentBody.model).toBe('deepseek-chat');
    expect(sentBody.reasoning_effort).toBe('high'); // 原生字段零损耗
    expect(res.statusCode).toBe(200);
    expect(res.sentText).toBe('{"id":"c1"}');
  });

  it('上游错误体原样透传（状态码 + 原生 OpenAI 错误 JSON）', async () => {
    vi.mocked(sendUpstream).mockResolvedValue({
      status: 401, headers: { 'content-type': 'application/json' },
      text: async () => '{"error":{"message":"Incorrect API key","type":"invalid_request_error","code":"invalid_api_key"}}',
      stream: async () => {},
    } as any);
    const { req, res } = mockReqRes({ model: 'deepseek:m' });
    await passthroughOpenAI(req, res, oaProvider, 'm');
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.sentText!).error.code).toBe('invalid_api_key');
  });

  it('流式 SSE 原样 pipe 回传', async () => {
    const sseLines = ['data: {"choices":[{"delta":{"content":"hi"}}]}', '', 'data: [DONE]', ''];
    vi.mocked(sendUpstream).mockResolvedValue({
      status: 200, headers: { 'content-type': 'text/event-stream' },
      text: async () => { throw new Error('not called'); },
      stream: async (onLine: (l: string) => void) => { sseLines.forEach(onLine); },
    } as any);
    const { req, res, writes } = mockReqRes({ model: 'deepseek:m', stream: true });
    await passthroughOpenAI(req, res, oaProvider, 'm');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(writes.join('')).toBe(sseLines.map(l => l + '\n').join(''));
  });

  it('上游连接失败返回 502 OpenAI 格式错误体', async () => {
    vi.mocked(sendUpstream).mockRejectedValue(new Error('ECONNREFUSED'));
    const { req, res } = mockReqRes({ model: 'deepseek:m' });
    await passthroughOpenAI(req, res, oaProvider, 'm');
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.sentText!).error.type).toBe('api_error');
  });

  it('baseUrl 已含 /v1 不重复拼接', async () => {
    vi.mocked(sendUpstream).mockResolvedValue({
      status: 200, headers: {}, text: async () => '{}', stream: async () => {},
    } as any);
    const { req, res } = mockReqRes({ model: 'deepseek:m' });
    await passthroughOpenAI(req, res, { ...oaProvider, baseUrl: 'https://api.deepseek.com/v1' }, 'm');
    expect(vi.mocked(sendUpstream).mock.calls[0]![0].url).toBe('https://api.deepseek.com/v1/chat/completions');
  });
});
