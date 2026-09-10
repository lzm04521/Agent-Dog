/**
 * Stdio proxy - MCP client connecting to daemon
 * Acts as a bridge between MCP client and daemon
 */

import { createInterface } from 'readline';
import { DaemonClient } from './daemon-client.js';

export interface StdioProxyOptions {
  /**
   * daemon 连接持续被拒（如被意外杀死）时的自救回调，
   * 由调用方传入重新拉起 daemon 的逻辑；不传则仅被动重连
   */
  autoRestart?: () => void | Promise<void>;
}

export class StdioProxy {
  private daemonClient: DaemonClient;
  private readline: any;
  private isReady = false;
  // 自拉起冷却时间戳，防止频繁 spawn
  private lastRespawnAt = 0;

  constructor(daemonPort?: number | string, private options: StdioProxyOptions = {}) {
    // 兼容两种入参：Web 端口号（数字）或完整 baseUrl（字符串）
    const baseUrl = typeof daemonPort === 'string'
      ? daemonPort
      : `http://localhost:${daemonPort ?? 61125}`;
    this.daemonClient = new DaemonClient({
      baseUrl,
      clientType: 'stdio',
      silent: true // Enable silent mode to avoid log pollution in stdio
    });

    this.setupStdio();
    this.setupDaemonClient();
  }

  private setupStdio() {
    this.readline = createInterface({
      input: process.stdin,
      output: process.stdout,
      crlfDelay: Infinity
    });

    this.readline.on('line', (line: string) => {
      this.handleStdioInput(line.trim());
    });

    this.readline.on('close', () => {
      this.shutdown();
    });

    // Handle process signals
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  private setupDaemonClient() {
    // 本地 DaemonClient 为 HTTP 探活模型：connect() 成功即 connected+ready 连发，
    // 无 socket welcome/disconnected/error 事件；daemon 断线自愈改在请求失败路径处理
    this.daemonClient.on('connected', () => {
      this.isReady = true;
    });

    this.daemonClient.on('ready', () => {
      this.isReady = true;
    });
  }

  /**
   * daemon 不可达时带冷却地重新拉起（30 秒冷却防止频繁 spawn）。
   * 本次请求仍返回错误，daemon 就绪后后续请求自愈。
   */
  private maybeAutoRestart(): void {
    if (!this.options.autoRestart) return;
    if (Date.now() - this.lastRespawnAt < 30000) return;
    this.lastRespawnAt = Date.now();
    process.stderr.write('[AgentDog] daemon unreachable, attempting to restart daemon...\n');
    void this.options.autoRestart();
  }

  private async handleStdioInput(line: string) {
    if (!line) return;

    try {
      const request = JSON.parse(line);
      
      // Check if it's a notification message (no id field)
      if (!('id' in request)) {
        // Notification messages are temporarily ignored or forwarded to daemon
        return;
      }

      // If daemon connection is not ready yet, wait a bit
      if (!this.isReady) {
        // Give some time for connection to establish
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // If still not ready, try to send request directly
      if (!this.isReady && !this.daemonClient.connected) {
        this.sendStdioResponse({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32603,
            message: "AgentDog daemon not connected"
          }
        });
        return;
      }

      // Forward MCP request to daemon; on failure return a JSON-RPC error instead of hanging
      let response;
      try {
        response = await this.daemonClient.sendMCPRequest(request);
      } catch (error) {
        // daemon 不可达（如半路被杀）：尝试重新拉起，后续请求自愈
        this.maybeAutoRestart();
        this.sendStdioResponse({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32603,
            message: `AgentDog daemon request failed: ${(error as Error).message}`
          }
        });
        return;
      }

      // Send response back to stdio
      this.sendStdioResponse(response);
      
    } catch (error) {
      // Don't output error logs to stderr to avoid polluting MCP protocol
              // Send standard JSON-RPC error response
      try {
        const request = JSON.parse(line);
        if ('id' in request) {
          this.sendStdioResponse({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32700,
              message: "Parse error"
            }
          });
        }
      } catch {
        // Unable to parse request, ignore
      }
    }
  }

  private sendStdioResponse(response: any) {
    // Write response directly to stdout for MCP protocol
    const responseStr = JSON.stringify(response) + '\n';
    process.stdout.write(responseStr);
    
    // Log summary to stderr for debugging (avoid stdout pollution)
    if (responseStr.length > 1000) {
      process.stderr.write(`[DEBUG] Response sent (${responseStr.length} chars)\n`);
    }
  }

  async start(): Promise<void> {
    try {
      await this.daemonClient.connect();
      // After successful connection, start processing MCP requests
    } catch (error) {
      // 启动时 daemon 探活失败：带冷却地拉起一次再重试连接（拉起失败仍按原逻辑退出）
      const cooldownOver = Date.now() - this.lastRespawnAt >= 30000;
      if (this.options.autoRestart && cooldownOver) {
        this.lastRespawnAt = Date.now();
        process.stderr.write('[AgentDog] daemon unreachable, attempting to restart daemon...\n');
        try {
          await this.options.autoRestart();
          await this.daemonClient.connect();
          return;
        } catch {
          // 重新拉起后仍连不上，走退出路径
        }
      }
      process.stderr.write(`AgentDog failed to connect to daemon: ${(error as Error).message}\n`);
      process.exit(1);
    }
  }

  private shutdown() {
    // Silent shutdown, no log output
    if (this.readline) {
      this.readline.close();
    }
    this.daemonClient.disconnect();
    process.exit(0);
  }
}