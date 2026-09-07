// 端到端集成测试：本地 mock 上游 + 真实 AiGatewayServer（随机端口）
// 覆盖三条通道：anthropic 直通 / openai 转换 / 错误透传 / 客户端断连清理
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { ConfigManager } from '../config/config-manager.js';
import { AiGatewayServer } from './gateway-server.js';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const GATEWAY_KEY = 'ad-sk-itest';

// openai 流式 SSE fixture：文本 + finish + usage + [DONE]
const OPENAI_SSE = [
  'data: {"choices":[{"delta":{"role":"assistant"}}]}',
  '',
  'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}',
  '',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
  '',
  'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}',
  '',
  'data: [DONE]',
  '',
].join('\n');

describe('AI gateway 端到端', () => {
  let upstream: any;
  let upstreamPort: number;
  let upstreamConnectionsClosed = 0;
  let gateway: AiGatewayServer;
  let gwPort: number;
  const configPath = join(tmpdir(), `mcpdog-gw-itest-${Date.now()}.json`);

  beforeAll(async () => {
    // mock 上游
    upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        req.on('close', () => upstreamConnectionsClosed++);
        const url = req.url || '';
        if (url.startsWith('/openai/v1/chat/completions')) {
          const parsed = JSON.parse(body);
          if (req.headers.authorization !== 'Bearer sk-up') {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Incorrect API key' } }));
            return;
          }
          if (parsed.stream) {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.end(OPENAI_SSE);
          } else {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '你好' } }],
              usage: { prompt_tokens: 12, completion_tokens: 3 },
            }));
          }
          return;
        }
        if (url.startsWith('/anthropic/v1/messages')) {
          if (req.headers['x-api-key'] !== 'sk-ant') {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
            return;
          }
          const parsed = JSON.parse(body);
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(`event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`);
          void parsed;
          return;
        }
        res.writeHead(404); res.end('{}');
      });
    });
    await new Promise<void>(r => upstream.listen(0, '127.0.0.1', () => r()));
    upstreamPort = (upstream.address() as any).port;

    const cm = new ConfigManager(configPath, false);
    await cm.setAIGateway({ enabled: true, port: 0, host: '127.0.0.1', apiKey: GATEWAY_KEY } as any);
    // port: 0 → 由 listen 分配；读取实际配置需在 start 前写回真实端口
    gwPort = await new Promise<number>(async (resolve) => {
      // 找一个空闲端口
      const probe = createServer();
      probe.listen(0, '127.0.0.1', () => {
        const port = (probe.address() as any).port;
        probe.close(() => resolve(port));
      });
    });
    await cm.setAIGateway({ enabled: true, port: gwPort, host: '127.0.0.1', apiKey: GATEWAY_KEY });
    cm.addAIProvider({
      id: 'p-openai', slug: 'deepseek', dialect: 'openai',
      baseUrl: `http://127.0.0.1:${upstreamPort}/openai`, apiKey: 'sk-up', enabled: true,
    });
    cm.addAIProvider({
      id: 'p-anthropic', slug: 'official', dialect: 'anthropic',
      baseUrl: `http://127.0.0.1:${upstreamPort}/anthropic`, apiKey: 'sk-ant', enabled: true,
    });

    gateway = new AiGatewayServer(cm);
    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
    await new Promise<void>(r => upstream.close(() => r()));
    await fsPromises.unlink(configPath).catch(() => {});
  });

  it('openai 转换通道：流式事件序列完整（延迟提交 + usage 汇总）', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({
        model: 'deepseek:deepseek-chat',
        max_tokens: 100, stream: true,
        messages: [{ role: 'user', content: '你好' }],
      }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toContain('text/event-stream');
    const text = await resp.text();
    // 事件序列断言（Claude Code 解析契约）
    expect(text).toContain('event: message_start');
    expect(text).toContain('"text_delta","text":"你好"');
    expect(text).toContain('event: content_block_stop');
    expect(text).toContain('"stop_reason":"end_turn"');
    expect(text).toContain('"input_tokens":12,"output_tokens":3');
    expect(text).toContain('event: message_stop');
  });

  it('openai 转换通道：非流式聚合为 Message JSON', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({
        model: 'deepseek:deepseek-chat', max_tokens: 100,
        messages: [{ role: 'user', content: '你好' }],
      }),
    });
    const json = await resp.json();
    expect(json.type).toBe('message');
    expect(json.content).toEqual([{ type: 'text', text: '你好' }]);
    expect(json.usage).toEqual({ input_tokens: 12, output_tokens: 3 });
  });

  it('anthropic 直通通道：SSE 原样回传', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${GATEWAY_KEY}` },
      body: JSON.stringify({
        model: 'official:claude-sonnet-4', max_tokens: 10, stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(resp.status).toBe(200);
    const text = await resp.text();
    expect(text).toContain('event: message_start');
    expect(text).toContain('"input_tokens":5'); // 原生 usage 透传
  });

  it('上游 401 错误透传：状态码保留 + Anthropic 格式 + message 原文', async () => {
    const cm = gateway['configManager'];
    cm.updateAIProvider('p-openai', { apiKey: 'sk-wrong' });
    try {
      const resp = await fetch(`http://127.0.0.1:${gwPort}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
        body: JSON.stringify({
          model: 'deepseek:m', max_tokens: 10, stream: true,
          messages: [{ role: 'user', content: 'x' }],
        }),
      });
      expect(resp.status).toBe(401);
      const json = await resp.json();
      expect(json.type).toBe('error');
      expect(json.error.type).toBe('authentication_error');
      expect(json.error.message).toContain('Incorrect API key'); // 上游原文
    } finally {
      cm.updateAIProvider('p-openai', { apiKey: 'sk-up' });
    }
  });

  it('客户端断连后上游连接被关闭（abort 链）', async () => {
    const before = upstreamConnectionsClosed;
    const ac = new AbortController();
    const resp = await fetch(`http://127.0.0.1:${gwPort}/v1/messages`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({
        model: 'deepseek:m', max_tokens: 10, stream: true,
        messages: [{ role: 'user', content: 'x' }],
      }),
    });
    expect(resp.status).toBe(200);
    ac.abort(); // 客户端断连
    await new Promise(r => setTimeout(r, 300));
    expect(upstreamConnectionsClosed).toBeGreaterThan(before);
  });

  it('错 slug 返回 400 带可用列表', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'nope:m', max_tokens: 1, messages: [] }),
    });
    expect(resp.status).toBe(400);
    const json = await resp.json();
    expect(json.error.message).toContain('deepseek');
    expect(json.error.message).toContain('official');
  });
});
