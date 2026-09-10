import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DaemonWebServer } from './daemon-web-server.js';
import { ConfigManager } from '../config/config-manager.js';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// mock 上游模型拉取
vi.mock('../ai-gateway/upstream/model-lister.js', () => ({
  listUpstreamModels: vi.fn().mockResolvedValue({ ok: true, status: 200, models: ['m1', 'm2'], message: 'ok' }),
}));

const configPath = join(tmpdir(), `agentdog-ai-test-${Date.now()}.json`);

function createTestServer() {
  const configManager = new ConfigManager(configPath, false);
  const daemonMock: any = new (require('events').EventEmitter)(); // setupDaemonEvents 需要 on()
  daemonMock.getConfigManager = () => configManager;
  daemonMock.restartAiGateway = vi.fn().mockResolvedValue(undefined);
  daemonMock.getAiGateway = () => undefined;
  const webServer = new DaemonWebServer(daemonMock as any, 0, '127.0.0.1');
  return { webServer, configManager, daemonMock };
}

describe('AI providers CRUD API', () => {
  let server: any;
  let baseUrl: string;
  let daemonMock: any;

  beforeAll(async () => {
    const t = createTestServer();
    daemonMock = t.daemonMock;
    await new Promise<void>(resolve => {
      server = (t.webServer as any).app.listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fsPromises.unlink(configPath).catch(() => {});
  });

  it('新增 provider 后列表 apiKey 脱敏', async () => {
    const create = await fetch(`${baseUrl}/ai-providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'deepseek', dialect: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-1234567890ab' }),
    });
    expect(create.status).toBe(201);

    const list = await (await fetch(`${baseUrl}/ai-providers`)).json();
    expect(list).toHaveLength(1);
    expect(list[0].apiKey).toBe('***********90ab');
    expect(list[0].slug).toBe('deepseek');
  });

  it('重复 slug 返回 400', async () => {
    const resp = await fetch(`${baseUrl}/ai-providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'deepseek', dialect: 'openai', baseUrl: 'https://x', apiKey: 'k' }),
    });
    expect(resp.status).toBe(400);
  });

  it('非法 slug 格式返回 400', async () => {
    const resp = await fetch(`${baseUrl}/ai-providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'Bad_Slug', dialect: 'openai', baseUrl: 'https://x', apiKey: 'k' }),
    });
    expect(resp.status).toBe(400);
  });

  it('PUT 更新：apiKey 留空不覆盖', async () => {
    const list = await (await fetch(`${baseUrl}/ai-providers`)).json();
    const id = list[0].id;
    const resp = await fetch(`${baseUrl}/ai-providers/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '深度求索', apiKey: '' }),
    });
    expect(resp.status).toBe(200);
    await new Promise(r => setTimeout(r, 150)); // 写方法落盘为异步 fire-and-forget
    const cfg = JSON.parse(await fsPromises.readFile(configPath, 'utf-8'));
    expect(cfg.providers[0].apiKey).toBe('sk-1234567890ab');
    expect(cfg.providers[0].name).toBe('深度求索');
  });

  it('DELETE 后列表为空', async () => {
    const list = await (await fetch(`${baseUrl}/ai-providers`)).json();
    const resp = await fetch(`${baseUrl}/ai-providers/${list[0].id}`, { method: 'DELETE' });
    expect(resp.status).toBe(200);
    const after = await (await fetch(`${baseUrl}/ai-providers`)).json();
    expect(after).toHaveLength(0);
  });

  it('网关设置更新触发 restartAiGateway 并生成 apiKey', async () => {
    const resp = await fetch(`${baseUrl}/ai-gateway/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, port: 62125 }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.apiKey).toMatch(/^ad-sk-/);
    expect(body.enabled).toBe(true);
    expect(daemonMock.restartAiGateway).toHaveBeenCalled();
  });

  it('网关状态回报挂载语义（daemon 无独立实例时端口=Web 端口）', async () => {
    const status = await (await fetch(`${baseUrl}/ai-gateway/status`)).json();
    expect(status.enabled).toBe(true);
    expect(status.port).toBe(0); // createTestServer 以 port 0 构造（挂载形态回报 Web 端口）
    expect(status.running).toBe(false); // 测试直接 app.listen，未走 webServer.start()，内部 listening 未知
    expect(status.apiKey).toMatch(/^ad-sk-/);
  });

  it('网关方言路由挂载在 Web 端口：前缀可达、apiKey 认证、openai 入口错 model 400、不影响 /api', async () => {
    const root = baseUrl.replace('/api', '');
    const { apiKey } = await (await fetch(`${baseUrl}/ai-gateway/status`)).json();

    const badSlug = await fetch(`${root}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ model: 'nope:m', max_tokens: 1, messages: [] }),
    });
    expect(badSlug.status).toBe(400);

    const noKey = await fetch(`${root}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(noKey.status).toBe(401);

    const badModel = await fetch(`${root}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: '{}',
    });
    expect(badModel.status).toBe(400);
    const badModelJson = await badModel.json();
    expect(badModelJson.error.code).toBe('model_not_found');

    // 网关中间件对非网关路径放行，/api 正常
    const webApi = await fetch(`${baseUrl}/ai-providers`);
    expect(webApi.status).toBe(200);
  });

  it('test 与 models 端点', async () => {
    const create = await fetch(`${baseUrl}/ai-providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'p1', dialect: 'openai', baseUrl: 'https://x', apiKey: 'k' }),
    });
    const { provider } = await create.json();
    const test = await (await fetch(`${baseUrl}/ai-providers/${provider.id}/test`, { method: 'POST' })).json();
    expect(test.ok).toBe(true);
    expect(test.modelCount).toBe(2);
    const models = await (await fetch(`${baseUrl}/ai-providers/${provider.id}/models`, { method: 'POST' })).json();
    expect(models.models).toEqual(['m1', 'm2']);
  });
});
