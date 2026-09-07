import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { DaemonWebServer, resolveListenHost } from './daemon-web-server';

// 构造最小 fake daemon：DaemonWebServer 构造期只调 getConfigManager()，
// 事件监听只注册不触发；请求期访问 getFullStatus / mcpServer（均为私有访问，普通属性即可）
function createFakeDaemon() {
  const daemon: any = new EventEmitter();
  daemon.getConfigManager = () => ({}) as any;
  daemon.getFullStatus = () => ({
    daemon: { isRunning: true, clients: [], uptime: 1 },
    mcpServer: { initialized: true },
    servers: []
  });
  daemon.recordClientActivity = () => {};
  daemon.mcpServer = {
    handleRequest: async (request: any, clientId?: string) => ({
      jsonrpc: '2.0',
      id: request.id,
      result: { method: request.method, clientId }
    })
  };
  return daemon;
}

// 端口 0 = 系统分配临时端口，避免与真实服务/Windows 排除区冲突
async function startTestServer(daemon: any, host?: string) {
  const webServer = new DaemonWebServer(daemon, 0, host);
  await webServer.start();
  const port = (webServer as any).server.address().port;
  return { webServer, baseUrl: `http://localhost:${port}` };
}

describe('resolveListenHost', () => {
  it('未配置 host 默认 localhost', () => {
    expect(resolveListenHost(undefined, false)).toBe('localhost');
  });

  it('回环地址无 token 也允许', () => {
    expect(resolveListenHost('127.0.0.1', false)).toBe('127.0.0.1');
    expect(resolveListenHost('::1', false)).toBe('::1');
  });

  it('0.0.0.0 且无 token 时抛错拒启', () => {
    expect(() => resolveListenHost('0.0.0.0', false)).toThrow(/MCPDOG_AUTH_TOKEN/);
  });

  it('0.0.0.0 且有 token 时允许', () => {
    expect(resolveListenHost('0.0.0.0', true)).toBe('0.0.0.0');
  });
});

describe('DaemonWebServer 监听', () => {
  let webServer: DaemonWebServer;
  let baseUrl: string;

  beforeAll(async () => {
    delete process.env.MCPDOG_AUTH_TOKEN;
    ({ webServer, baseUrl } = await startTestServer(createFakeDaemon()));
  });

  afterAll(async () => {
    await webServer.stop();
  });

  it('GET /api/status 返回 daemon 状态', async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    const status = await res.json();
    expect(status.daemon.isRunning).toBe(true);
  });

  it('POST /api/mcp 转发 MCP 请求并把 X-MCPDog-Client 作为 clientId', async () => {
    const res = await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCPDog-Client': 'client_test_1' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(7);
    expect(body.result.method).toBe('tools/list');
    expect(body.result.clientId).toBe('client_test_1');
  });

  it('POST /api/mcp 缺省 clientId 时用 http-anonymous', async () => {
    const res = await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'ping' })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.clientId).toBe('http-anonymous');
  });

  it('POST /api/mcp 非 JSON-RPC 结构返回 400', async () => {
    const res = await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    });
    expect(res.status).toBe(400);
  });
});
