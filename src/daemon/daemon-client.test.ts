import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server } from 'http';
import { DaemonClient } from './daemon-client';

describe('DaemonClient (HTTP)', () => {
  let server: Server;
  let baseUrl: string;
  let mcpFailFirst = false;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        if (req.method === 'GET' && req.url === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ daemon: { isRunning: true } }));
        } else if (req.method === 'POST' && req.url === '/api/mcp') {
          if (mcpFailFirst) {
            mcpFailFirst = false; // 模拟 daemon 重启后首次请求失败
            res.writeHead(503);
            res.end('{}');
            return;
          }
          const request = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: { clientId: req.headers['x-agentdog-client'] }
          }));
        } else {
          res.writeHead(404);
          res.end('{}');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, 'localhost', r));
    baseUrl = `http://localhost:${(server.address() as any).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('connect 探活成功后 resolve 并置 connected', async () => {
    const client = new DaemonClient({ baseUrl, clientType: 'cli', silent: true });
    await expect(client.connect()).resolves.toBeUndefined();
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('sendMCPRequest 转发 JSON-RPC 并携带 X-AgentDog-Client 头', async () => {
    const client = new DaemonClient({ baseUrl, clientType: 'cli', silent: true });
    const response = await client.sendMCPRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(response.id).toBe(1);
    expect(String(response.result.clientId)).toMatch(/^client_/);
  });

  it('daemon 重启场景：请求失败后探活可达则重试一次成功', async () => {
    mcpFailFirst = true;
    const client = new DaemonClient({ baseUrl, clientType: 'cli', silent: true, retryDelayMs: 10 });
    const response = await client.sendMCPRequest({ jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(response.id).toBe(2);
  });

  it('getStatus 返回 /api/status 的 JSON', async () => {
    const client = new DaemonClient({ baseUrl, clientType: 'cli', silent: true });
    const status = await client.getStatus();
    expect(status.daemon.isRunning).toBe(true);
  });

  it('服务不可达时 connect 重试耗尽后 reject', async () => {
    const client = new DaemonClient({
      baseUrl: 'http://localhost:1', // 无人监听端口，连接立即拒绝
      clientType: 'cli',
      silent: true,
      connectAttempts: 2,
      connectIntervalMs: 10
    });
    await expect(client.connect()).rejects.toThrow(/not reachable/);
  });
});
