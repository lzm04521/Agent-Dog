import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseSSEStream, sendUpstream } from './provider-client.js';

function sseChunks(lines: string[]): Uint8Array[] {
  // 模拟跨 chunk 半行的字节流切分
  return lines.map(l => new TextEncoder().encode(l));
}

describe('parseSSEStream', () => {
  it('逐帧回调完整 data 行，跨 chunk 行不撕裂', async () => {
    const lines: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: message\n'));
        controller.enqueue(new TextEncoder().encode('data: {"a"')); // 半行撕裂点
        controller.enqueue(new TextEncoder().encode(':1}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"b":2}\n\n'));
        controller.close();
      },
    });
    await parseSSEStream(stream, line => lines.push(line));
    expect(lines).toEqual(['event: message', 'data: {"a":1}', '', 'data: {"b":2}', '']);
  });

  it('空行与注释行原样回调（由调用方按需忽略）', async () => {
    const lines: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': ping\n\ndata: x\n\n'));
        controller.close();
      },
    });
    await parseSSEStream(stream, line => lines.push(line));
    expect(lines).toEqual([': ping', '', 'data: x', '']);
  });
});

describe('sendUpstream', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('返回状态/头与 text()', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{"ok":true}',
      body: null,
    }));
    const res = await sendUpstream({
      url: 'https://up.test/v1/messages', method: 'POST',
      headers: { 'x-api-key': 'k' }, body: '{}', timeoutMs: 5000,
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(await res.text()).toBe('{"ok":true}');
  });

  it('响应头超时抛 TimeoutError 语义错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(
      (_url: string, init: any) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      })
    ));
    await expect(sendUpstream({
      url: 'https://up.test', method: 'POST', headers: {}, timeoutMs: 50,
    })).rejects.toThrow(/timeout/i);
  });

  it('透传外部 signal abort', async () => {
    const ac = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(
      (_url: string, init: any) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      })
    ));
    const p = sendUpstream({ url: 'https://up.test', method: 'POST', headers: {}, timeoutMs: 5000, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });
});
