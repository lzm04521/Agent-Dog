/**
 * AgentDog Daemon Client（HTTP 版）
 * daemon IPC 已与 Web 端口合并（doc/20260907-设计文档-daemon-IPC与Web端口合并.md）：
 * 探活走 GET /api/status，MCP 转发走 POST /api/mcp，clientId 由 X-AgentDog-Client 头携带。
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export interface DaemonClientConfig {
  baseUrl: string;                        // 如 http://localhost:61125
  clientType: 'stdio' | 'web' | 'cli';
  token?: string;                         // 对应 daemon 的 MCPDOG_AUTH_TOKEN
  silent?: boolean;                       // 静默模式，不输出日志
  requestTimeoutMs?: number;              // 单请求超时，默认 120000
  connectAttempts?: number;               // connect 探活尝试次数，默认 10
  connectIntervalMs?: number;             // 探活间隔，默认 1000
  retryDelayMs?: number;                  // 请求失败重试前等待，默认 500
}

export class DaemonClient extends EventEmitter {
  private config: DaemonClientConfig & Required<Pick<DaemonClientConfig,
    'requestTimeoutMs' | 'connectAttempts' | 'connectIntervalMs' | 'retryDelayMs'>>;
  private isConnected = false;
  private readonly clientId: string;

  constructor(config: DaemonClientConfig) {
    super();
    this.config = {
      requestTimeoutMs: 120000,
      connectAttempts: 10,
      connectIntervalMs: 1000,
      retryDelayMs: 500,
      ...config
    };
    // token 缺省回退到环境变量：daemon 一旦设置 MCPDOG_AUTH_TOKEN，auth 中间件对所有 /api/*（含
    // /api/mcp、/api/status）强制 Bearer，且无 loopback 豁免（src/middleware/auth.ts:43-101）。本机
    // proxy/CLI 与 daemon 共享 env（auto-start 经 spawn 继承 process.env），缺省带上可避免
    // "设了 token 后本机 proxy/CLI 全部 401" 的合并回归（旧 IPC 9999 无鉴权）。
    if (!this.config.token && process.env.MCPDOG_AUTH_TOKEN) {
      this.config.token = process.env.MCPDOG_AUTH_TOKEN;
    }
    this.clientId = `client_${randomUUID().slice(0, 8)}`;
  }

  getClientId(): string {
    return this.clientId;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-AgentDog-Client': this.clientId
    };
    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }
    return headers;
  }

  // 探活一次（不重试）
  private async probeOnce(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/api/status`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5000)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Public API —— 探活重试直到 daemon 就绪（替代原 TCP welcome 语义）
  async connect(): Promise<void> {
    for (let i = 0; i < this.config.connectAttempts; i++) {
      if (await this.probeOnce()) {
        this.isConnected = true;
        if (!this.config.silent) {
          console.log(`[DAEMON-CLIENT] Daemon ready at ${this.config.baseUrl} (client ${this.clientId})`);
        }
        this.emit('connected');
        this.emit('ready');
        return;
      }
      if (i < this.config.connectAttempts - 1) {
        await new Promise((r) => setTimeout(r, this.config.connectIntervalMs));
      }
    }
    throw new Error(`Daemon not reachable at ${this.config.baseUrl} (tried ${this.config.connectAttempts} times)`);
  }

  disconnect(): void {
    this.isConnected = false;
  }

  private async postJson(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs)
    });
    if (!res.ok) {
      throw new Error(`daemon HTTP ${res.status} on ${path}`);
    }
    return res.json();
  }

  // MCP protocol forwarding —— 失败先探活，daemon 可达则重试一次
  // （替代原 socket reconnect 的 daemon 重启自愈语义）
  async sendMCPRequest(request: any): Promise<any> {
    try {
      return await this.postJson('/api/mcp', request);
    } catch (error) {
      await new Promise((r) => setTimeout(r, this.config.retryDelayMs));
      if (await this.probeOnce()) {
        return await this.postJson('/api/mcp', request);
      }
      throw error;
    }
  }

  async getStatus(): Promise<any> {
    const res = await fetch(`${this.config.baseUrl}/api/status`, {
      headers: this.buildHeaders(),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs)
    });
    if (!res.ok) {
      throw new Error(`daemon HTTP ${res.status} on /api/status`);
    }
    return res.json();
  }

  async getTools(): Promise<any> {
    const res = await fetch(`${this.config.baseUrl}/api/tools`, {
      headers: this.buildHeaders(),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs)
    });
    if (!res.ok) {
      throw new Error(`daemon HTTP ${res.status} on /api/tools`);
    }
    return res.json();
  }

  async reloadConfig(): Promise<any> {
    return this.postJson('/api/daemon/reload', {});
  }

  get connected(): boolean {
    return this.isConnected;
  }
}
