// 端到端集成测试：本地 mock 上游 + 真实 AiGatewayServer（随机端口）
// 覆盖通道：anthropic 直通 / openai 转换 / openai 入口（直通 + IR 转换）/ 错误透传 / 客户端断连清理 / 调用流水埋点
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { ConfigManager } from '../config/config-manager.js';
import { AiGatewayServer } from './gateway-server.js';
import { getRecentAiCalls, resetAiCallStoreForTests } from './call-log.js';
import { promises as fsPromises } from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// 调用流水落盘隔离目录（在 store 首次初始化前设置即生效）
process.env.AGENTDOG_LOG_DIR = mkdtempSync(join(tmpdir(), 'agentdog-itest-logs-'));

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
  const configPath = join(tmpdir(), `agentdog-gw-itest-${Date.now()}.json`);

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
          if (parsed.stream) {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.end([
              'event: message_start',
              'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}',
              '',
              'event: content_block_start',
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
              '',
              'event: content_block_delta',
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好的"}}',
              '',
              'event: content_block_stop',
              'data: {"type":"content_block_stop","index":0}',
              '',
              'event: content_block_start',
              'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}',
              '',
              'event: content_block_delta',
              'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"北京\\"}"}}',
              '',
              'event: content_block_stop',
              'data: {"type":"content_block_stop","index":1}',
              '',
              'event: message_delta',
              'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"input_tokens":9,"output_tokens":8}}',
              '',
              'event: message_stop',
              'data: {"type":"message_stop"}',
              '',
            ].join('\n'));
          } else {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-x',
              content: [{ type: 'text', text: '你好' }], stop_reason: 'end_turn', stop_sequence: null,
              usage: { input_tokens: 7, output_tokens: 2 },
            }));
          }
          return;
        }
        if (url.startsWith('/gemini/v1beta/models/')) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '好的' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } })}\n\n`);
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
    cm.updateAIProvider('p-openai', { models: ['deepseek-chat', 'deepseek-reasoner'], disabledModels: ['deepseek-reasoner'] });
    cm.updateAIProvider('p-anthropic', { models: ['claude-sonnet-4'] });
    cm.addAIProvider({
      id: 'p-gemini', slug: 'google', dialect: 'gemini',
      baseUrl: `http://127.0.0.1:${upstreamPort}/gemini`, apiKey: 'g-key', enabled: true,
    });

    gateway = new AiGatewayServer(cm);
    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
    await new Promise<void>(r => upstream.close(() => r()));
    await fsPromises.unlink(configPath).catch(() => {});
    rmSync(process.env.AGENTDOG_LOG_DIR as string, { recursive: true, force: true });
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

      // 调用流水：上游失败记状态码与响应正文摘要
      await new Promise(r => setTimeout(r, 100));
      const call = getRecentAiCalls().find(c => c.model === 'deepseek:m' && c.status === 401);
      expect(call).toBeDefined();
      expect(call!.providerName).toBe('deepseek');
      expect(call!.responseExcerpt).toContain('Incorrect API key');
      expect(call!.error).toContain('upstream 401');
    } finally {
      cm.updateAIProvider('p-openai', { apiKey: 'sk-up' });
    }
  });

  it('调用流水：成功调用记录路由命中与 usage', async () => {
    resetAiCallStoreForTests();
    const resp = await fetch(`http://127.0.0.1:${gwPort}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({
        model: 'deepseek:deepseek-chat', max_tokens: 100,
        messages: [{ role: 'user', content: '流水' }],
      }),
    });
    expect(resp.status).toBe(200);
    await resp.json();
    await new Promise(r => setTimeout(r, 100));

    const call = getRecentAiCalls().find(c => c.model === 'deepseek:deepseek-chat');
    expect(call).toBeDefined();
    expect(call!.ingress).toBe('anthropic'); // 裸 /v1/messages 别名归 anthropic
    expect(call!.path).toBe('/v1/messages');
    expect(call!.providerName).toBe('deepseek');
    expect(call!.upstreamModel).toBe('deepseek-chat');
    expect(call!.status).toBe(200);
    expect(call!.durationMs).toBeGreaterThanOrEqual(0);
    expect(call!.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
  });

  it('调用流水：路由失败（未知模型）记 400 与请求摘要', async () => {
    resetAiCallStoreForTests();
    const resp = await fetch(`http://127.0.0.1:${gwPort}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({
        model: 'nosuch:model-x', max_tokens: 10,
        messages: [{ role: 'user', content: 'x' }],
      }),
    });
    expect(resp.status).toBe(400);
    await resp.json();
    await new Promise(r => setTimeout(r, 100));

    const call = getRecentAiCalls().find(c => c.model === 'nosuch:model-x');
    expect(call).toBeDefined();
    expect(call!.status).toBe(400);
    expect(call!.providerName).toBe(''); // 未命中路由
    expect(call!.error).toBeTruthy();
    expect(call!.requestExcerpt).toContain('nosuch:model-x'); // 请求结构摘要含模型名
    expect(call!.requestExcerpt).toContain('1 messages');
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

  it('方言前缀路由：/anthropic/v1/messages 与裸路径同 handler', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({
        model: 'deepseek:deepseek-chat', max_tokens: 100,
        messages: [{ role: 'user', content: '你好' }],
      }),
    });
    expect(resp.status).toBe(200);
    const json = await resp.json();
    expect(json.type).toBe('message');
    expect(json.content).toEqual([{ type: 'text', text: '你好' }]);
  });

  it('方言前缀路由：/anthropic/v1/messages/count_tokens 已注册（错 slug 走 ModelRouteError）', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/anthropic/v1/messages/count_tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'nope:m', messages: [] }),
    });
    expect(resp.status).toBe(400);
    const json = await resp.json();
    expect(json.type).toBe('error');
    expect(json.error.message).toContain('available');
  });

  it('openai 入口直通：流式 chunk 原样回传', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'deepseek:deepseek-chat', stream: true, messages: [{ role: 'user', content: '你好' }] }),
    });
    expect(resp.status).toBe(200);
    const text = await resp.text();
    expect(text).toContain('"content":"你好"');
    expect(text).toContain('data: [DONE]');
  });

  it('openai 入口直通：非流式 JSON', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'deepseek:deepseek-chat', messages: [{ role: 'user', content: '你好' }] }),
    });
    const json = await resp.json();
    expect(json.choices[0].message.content).toBe('你好');
    expect(json.usage.prompt_tokens).toBe(12);
  });

  it('openai 入口 → anthropic 上游 IR：流式工具调用转换', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'official:claude-sonnet-4', stream: true, messages: [{ role: 'user', content: '北京天气' }] }),
    });
    expect(resp.status).toBe(200);
    const text = await resp.text();
    expect(text).toContain('"role":"assistant"');
    expect(text).toContain('"name":"get_weather"');
    expect(text).toContain('"finish_reason":"tool_calls"');
    expect(text).toContain('data: [DONE]');
  });

  it('openai 入口 → anthropic 上游 IR：非流式聚合 chat.completion', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'official:claude-sonnet-4', messages: [{ role: 'user', content: '你好' }] }),
    });
    const json = await resp.json();
    expect(json.object).toBe('chat.completion');
    expect(json.choices[0].message.content).toBe('你好');
    expect(json.choices[0].finish_reason).toBe('stop');
    expect(json.usage).toEqual({ prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 });
  });

  it('openai 入口 → gemini 上游 IR：流式文本', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'google:gemini-2.0-flash', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(resp.status).toBe(200);
    const text = await resp.text();
    expect(text).toContain('"content":"好的"');
    expect(text).toContain('data: [DONE]');
  });

  it('openai 入口：n>1 返回 400 OpenAI 格式错误体', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'deepseek:m', n: 2, messages: [{ role: 'user', content: 'x' }] }),
    });
    expect(resp.status).toBe(400);
    const json = await resp.json();
    expect(json.error.type).toBe('invalid_request_error');
    expect(json.error.message).toContain('n > 1');
  });

  it('openai 入口：错 slug 返回 400 + code=model_not_found', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'nope:m', messages: [{ role: 'user', content: 'x' }] }),
    });
    expect(resp.status).toBe(400);
    const json = await resp.json();
    expect(json.error.code).toBe('model_not_found');
    expect(json.error.message).toContain('deepseek');
  });

  it('GET /openai/v1/models：OpenAI 格式 + disabledModels 过滤', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/openai/v1/models`, { headers: { 'x-api-key': GATEWAY_KEY } });
    expect(resp.status).toBe(200);
    const json = await resp.json();
    expect(json.object).toBe('list');
    const ids = json.data.map((m: any) => m.id);
    expect(ids).toContain('deepseek:deepseek-chat');
    expect(ids).toContain('official:claude-sonnet-4');
    expect(ids).not.toContain('deepseek:deepseek-reasoner'); // disabledModels 被过滤
  });

  it('GET /anthropic/v1/models 与裸 /v1/models：Anthropic 格式', async () => {
    for (const path of ['/anthropic/v1/models', '/v1/models']) {
      const resp = await fetch(`http://127.0.0.1:${gwPort}${path}`, { headers: { 'x-api-key': GATEWAY_KEY } });
      expect(resp.status).toBe(200);
      const json = await resp.json();
      expect(json.data[0].type).toBe('model');
      expect(json.data[0].id).toBe('deepseek:deepseek-chat');
      expect(json.has_more).toBe(false);
    }
  });

  it('openai 路径认证失败返回 OpenAI 格式 401（Task 8 遗留用例回收）', async () => {
    const resp = await fetch(`http://127.0.0.1:${gwPort}/openai/v1/models`, { headers: { 'x-api-key': 'ad-sk-wrong' } });
    expect(resp.status).toBe(401);
    const json = await resp.json();
    expect(json.error.code).toBe('invalid_api_key');
  });
});
