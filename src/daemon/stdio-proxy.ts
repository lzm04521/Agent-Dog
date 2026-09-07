/**
 * Stdio proxy - MCP client connecting to daemon
 * Acts as a bridge between MCP client and daemon
 */

import { createInterface } from 'readline';
import { DaemonClient } from './daemon-client.js';

export class StdioProxy {
  private daemonClient: DaemonClient;
  private readline: any;
  private isReady = false;

  constructor(daemonPort?: number | string) {
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
    this.daemonClient.on('connected', () => {
      this.isReady = true;
    });

    this.daemonClient.on('ready', () => {
      this.isReady = true;
    });
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
            message: "MCPDog daemon not connected"
          }
        });
        return;
      }

      // Forward MCP request to daemon; on failure return a JSON-RPC error instead of hanging
      let response;
      try {
        response = await this.daemonClient.sendMCPRequest(request);
      } catch (error) {
        this.sendStdioResponse({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32603,
            message: `MCPDog daemon request failed: ${(error as Error).message}`
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
      process.stderr.write(`MCPDog failed to connect to daemon: ${(error as Error).message}\n`);
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