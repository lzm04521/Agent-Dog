/**
 * MCP Proxy CLI command - Connect to daemon as MCP client proxy
 */

import { ConfigManager } from '../../config/config-manager.js';
import { CLIUtils } from '../cli-utils.js';
import { StdioMCPServer } from '../../index.js';
import { StreamableHttpMCPServer } from '../../streamable-http-server.js';
import { readDaemonInfo, isProcessAlive } from '../../daemon/daemon-info.js';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { Socket } from 'net';
import path from 'path';
import os from 'os';

export class ProxyCommand {
  private agentdogDir: string;

  constructor(private configManager: ConfigManager) {
    // Use ~/.agentdog directory for PID files
    this.agentdogDir = path.join(os.homedir(), '.agentdog');
  }

  /**
   * Get default PID file path in ~/.agentdog directory
   */
  private getDefaultPidFile(): string {
    return path.join(this.agentdogDir, 'agentdog.pid');
  }

  async execute(args: string[], options: Record<string, any>): Promise<void> {
    if (options.help) {
      this.showHelp();
      return;
    }

    // Check transport type
    const transport = options.transport || 'stdio';
    
    if (transport === 'streamable-http') {
      await this.startHttpMode(options);
    } else if (options['web-port']) {
      await this.startWebMode(options);
    } else {
      await this.startStdioMode(options);
    }
  }

  private async startStdioMode(options: Record<string, any>): Promise<void> {
    if (options['daemon-port']) {
      process.stderr.write(
        'AgentDog: --daemon-port has been removed. The daemon now shares the Web port; ' +
        'remove the --daemon-port argument from your MCP client config ' +
        '(daemon address: http://localhost:<web.port>, default 61125).\n'
      );
      process.exit(1);
    }

    const pidFile = options['pid-file'] || this.getDefaultPidFile();

    try {
      // Web 端口决策链与 daemon 一致：配置 web.port > 默认 61125
      await this.configManager.loadConfig();
      const webPort = this.configManager.getWebPort() ?? 61125;

      // Check if daemon is running, auto-start if not
      const isDaemonRunning = await this.isDaemonRunning(pidFile, webPort);

      if (!isDaemonRunning) {
        // Auto-start daemon; web port 由 daemon 端口决策链自行决定，不传参
        await this.autoStartDaemonSilent(pidFile);

        // 等待 daemon 的 Web 端口真正开始监听（npx 冷启动时固定等待不可靠），
        // 超时后仍交给 StdioProxy 做最终连接判定
        await this.waitForDaemonPort(webPort, 15000);
      }

      // In MCP stdio mode, don't output any debug logs to stderr
      // All non-JSON output will be mistaken as responses by MCP clients

      const { StdioProxy } = await import('../../daemon/stdio-proxy.js');
      const proxy = new StdioProxy(webPort, {
        // daemon 半路被杀时，由 proxy 自动重新拉起，长会话可自愈
        autoRestart: () => this.autoStartDaemonSilent(pidFile)
      });

      process.on('SIGINT', () => process.exit(0));
      process.on('SIGTERM', () => process.exit(0));

      await proxy.start();
      await new Promise(() => {}); // Wait forever

    } catch (error) {
      process.stderr.write(`AgentDog: Failed to connect to daemon (web port from config)\n`);
      process.stderr.write(`Please ensure daemon is running: agentdog daemon start\n`);
      process.exit(1);
    }
  }

  private async startWebMode(options: Record<string, any>): Promise<void> {
    const port = parseInt(options['web-port']);
    
    // In MCP mode, suppress all output to avoid JSON parsing errors
    // Just switch to stdio mode silently
    await this.startStdioMode(options);
  }

  private async startHttpMode(options: Record<string, any>): Promise<void> {
    const httpPort = parseInt(options.port) || 4000;
    
    try {
      const httpServer = new StreamableHttpMCPServer(this.configManager, httpPort);
      
      // Graceful shutdown handling
      process.on('SIGINT', () => {
        process.exit(0);
      });
      
      process.on('SIGTERM', () => {
        process.exit(0);
      });
      
      await httpServer.start();
      
      // Prevent command exit from terminating process
      await new Promise(() => {}); // Wait forever

    } catch (error) {
      // Only output error on connection failure, then exit immediately
      // Use process.stderr.write instead of CLIUtils to avoid color codes
      process.stderr.write(`AgentDog: Failed to start HTTP server on port ${httpPort}\n`);
      process.stderr.write(`Error: ${(error as Error).message}\n`);
      process.exit(1);
    }
  }

  /**
   * Check if daemon is running by checking PID file (shared dual-format parser).
   * PID 存活还需要端口握手确认：Windows 重启后 PID 可能被无关进程复用，
   * 仅凭进程存在会误判 daemon 在运行而跳过拉起。
   */
  private async isDaemonRunning(pidFile: string, webPort: number): Promise<boolean> {
    const info = await readDaemonInfo(pidFile);
    if (!info) return false;

    if (!isProcessAlive(info.pid)) {
      // Clean up stale PID file
      try {
        await fs.unlink(pidFile);
      } catch {
        // Ignore errors when cleaning up
      }
      return false;
    }

    // 进程存在但目标端口无监听 → PID 已被复用或 daemon 已死，按未运行处理
    const portListening = await this.isPortListening(webPort);
    if (!portListening) {
      try {
        await fs.unlink(pidFile);
      } catch {
        // Ignore errors when cleaning up
      }
      return false;
    }
    return true;
  }

  /**
   * Probe whether the daemon port (Web 端口，daemon 与其合并监听) is accepting connections
   */
  private async isPortListening(port: number, timeoutMs = 800): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new Socket();
      const done = (result: boolean) => {
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
      socket.connect(port, 'localhost');
    });
  }

  /**
   * Poll the daemon port until it starts listening or timeout
   */
  private async waitForDaemonPort(port: number, timeoutMs: number, intervalMs = 500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isPortListening(port)) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  /**
   * Auto-start daemon in silent mode (no output to avoid MCP client errors)
   */
  private async autoStartDaemonSilent(pidFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const agentdogPath = process.argv[0]; // node executable path
      const scriptPath = process.argv[1]; // path to cli-main.js
      const configPath = this.configManager.getConfigPath();

      // Use --no-color and --json flags to suppress all output
      const daemon = spawn(agentdogPath, [
        scriptPath, 'daemon', 'start',
        '--config', configPath,
        '--pid-file', pidFile,
        '--no-color',
        '--json'
      ], {
        detached: true,
        stdio: 'ignore' // Completely ignore all stdio to avoid any output
      });
      
      // Detach the daemon process from parent
      daemon.unref();
      
      // Don't wait for the daemon to start completely, just for it to spawn
      daemon.on('spawn', () => {
        resolve();
      });
      
      daemon.on('error', (error) => {
        reject(error);
      });
      
      // If no spawn event in 5 seconds, consider it failed
      setTimeout(() => {
        reject(new Error('Daemon failed to start within 5 seconds'));
      }, 5000);
    });
  }

  private showHelp(): void {
    console.log(`
${CLIUtils.colorize('agentdog proxy', 'cyan')} - Connect to AgentDog daemon as MCP client proxy

${CLIUtils.colorize('Usage:', 'yellow')}
  agentdog proxy [options]

${CLIUtils.colorize('Options:', 'yellow')}
  --transport <type>    Transport protocol: stdio (default) or streamable-http
  -p, --port <port>     Port for HTTP transport (default: 4000)
  --help               Show this help message

${CLIUtils.colorize('Description:', 'yellow')}
  This command starts AgentDog and acts as a proxy for MCP clients. It supports
  both stdio (for traditional MCP clients) and HTTP (for web-based clients).

${CLIUtils.colorize('Transport Types:', 'yellow')}
  stdio           - Standard input/output (default, for MCP clients like Claude Desktop)
  streamable-http - HTTP-based transport with JSON-RPC over HTTP

${CLIUtils.colorize('Examples:', 'yellow')}
  agentdog proxy                                    # Start with stdio transport
  agentdog proxy --transport streamable-http        # Start HTTP server on port 4000
  agentdog proxy --transport streamable-http --port 8080  # Start HTTP server on port 8080

${CLIUtils.colorize('MCP Client Configuration:', 'yellow')}
  
  For stdio transport (Claude Desktop, Cursor):
  {
    "agentdog": {
      "command": "agentdog",
      "args": ["proxy"]
    }
  }
  
  For streamable HTTP transport:
  First start server manually: agentdog --transport streamable-http --port 4000
  Then configure client:
  {
    "mcpServers": {
      "agentdog-http": {
        "type": "streamable-http",
        "url": "http://localhost:4000"
      }
    }
  }

${CLIUtils.colorize('Auto-Start Behavior (stdio mode):', 'yellow')}
  • Automatically detects if daemon is running
  • If not running, starts daemon in background with default settings
  • Uses configuration from ${this.configManager.getConfigPath()}
  • No manual daemon startup required
`);
  }
}