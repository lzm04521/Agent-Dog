/**
 * Daemon-related commands
 */

import { CLIUtils } from '../cli-utils.js';
import { ConfigManager } from '../../config/config-manager.js';
import { AgentDogDaemon } from '../../daemon/agentdog-daemon.js';
import { DaemonClient } from '../../daemon/daemon-client.js';
import { readDaemonInfo } from '../../daemon/daemon-info.js';
import { startDaemonFileLogging } from '../../logging/daemon-file-logger.js';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'net';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class DaemonCommands {
  private configManager: ConfigManager;
  private agentdogDir: string;

  constructor(configPath?: string) {
    this.configManager = new ConfigManager(configPath);
    // Create ~/.agentdog directory for PID files and configs
    this.agentdogDir = path.join(os.homedir(), '.agentdog');
  }

  /**
   * Ensure ~/.agentdog directory exists
   */
  private async ensureAgentDogDir(): Promise<void> {
    try {
      await fs.mkdir(this.agentdogDir, { recursive: true });
    } catch (error) {
      // Directory already exists or cannot be created
    }
  }

  /**
   * Get default PID file path in ~/.agentdog directory
   */
  private getDefaultPidFile(): string {
    return path.join(this.agentdogDir, 'agentdog.pid');
  }

  /**
   * Check if a port is available
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      server.listen(port, 'localhost', () => {
        server.close();
        resolve(true);
      });
      server.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Find an available port starting from the given port
   */
  private async findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }
    throw new Error(`No available port found starting from ${startPort} (tried ${maxAttempts} ports)`);
  }

  /**
   * Reserve a port by actually binding to it
   */
  private async reservePort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      server.listen(port, 'localhost', () => {
        // Keep the server running to reserve the port
        resolve(true);
      });
      server.on('error', () => {
        resolve(false);
      });
    });
  }

  async start(args: string[], options: any): Promise<void> {
    if (options['daemon-port']) {
      CLIUtils.error(
        '--daemon-port has been removed: daemon IPC has been merged into the Web port. ' +
        'Use --web-port instead (or rely on the persisted web.port config).'
      );
      process.exit(1);
    }
    let webPort = parseInt(options['web-port']);
    const explicitWebPort = !isNaN(webPort) && webPort > 0;
    const pidFile = options['pid-file'] || this.getDefaultPidFile();

    // 本实例独立于 cli-router 的 ConfigManager，必须自行加载配置：
    // 否则 getWebPort 恒为 null、setWebPort 会以未加载的默认配置覆写用户配置
    await this.configManager.loadConfig();

    try {
      // Ensure ~/.agentdog directory exists
      await this.ensureAgentDogDir();

      // Check if daemon is already running；版本不同（或旧格式 PID 文件无版本信息）时自动升级重启
      const runningInfo = await this.getDaemonInfoFromFile(pidFile);
      if (runningInfo) {
        let running = false;
        try {
          process.kill(runningInfo.pid, 0);
          running = true;
        } catch {
          running = false;
        }

        if (running) {
          const currentVersion = this.readPackageVersion();
          const runningVersion = runningInfo.version;

          if (runningVersion && runningVersion === currentVersion) {
            CLIUtils.error(`Daemon is already running (PID: ${runningInfo.pid}, v${runningVersion})`);
            process.exit(1);
          }

          CLIUtils.info(`Detected running daemon v${runningVersion ?? 'unknown (old format)'} (PID: ${runningInfo.pid}), upgrading to v${currentVersion}...`);
          await this.stopDaemonByPid(runningInfo.pid);
          try {
            await fs.unlink(pidFile);
          } catch {
            // PID 文件不存在则忽略
          }
          CLIUtils.success(`Old daemon stopped, starting v${currentVersion}...`);
        }
      }

      // Web 端口决策链：显式 --web-port（用后保存）> 配置保存值 > 默认 61125
      if (explicitWebPort) {
        // 显式指定：记住该设置，之后启动不再需要传参
        await this.configManager.setWebPort(webPort);
        CLIUtils.info(`Web port saved to config: ${webPort}`);
      } else {
        // 未显式指定：用保存值或默认值探测可用端口；探测漂移值不回写，避免污染保存值
        const desired = this.configManager.getWebPort() ?? 61125;
        webPort = await this.findAvailablePort(desired);
        CLIUtils.info(`Auto-detected available web port: ${webPort}`);
      }

      // AI 网关端口：显式 --gateway-port 时持久化并启用网关（复用 --web-port 决策链模式）
      const gatewayPort = parseInt(options['gateway-port']);
      if (!isNaN(gatewayPort) && gatewayPort > 0) {
        const gatewayCfg = this.configManager.getAIGatewayConfig() || {
          enabled: true, port: gatewayPort, host: '127.0.0.1', apiKey: '',
        };
        gatewayCfg.enabled = true;
        gatewayCfg.port = gatewayPort;
        await this.configManager.setAIGateway(gatewayCfg);
        CLIUtils.info(`AI gateway enabled, port saved to config: ${gatewayPort}`);
      }

      // daemon 通常以 detached + stdio:'ignore' 启动，输出全部丢弃；先开启文件日志再初始化，
      // 后续所有启动/运行日志都有据可查
      const daemonLogFile = startDaemonFileLogging(this.agentdogDir);
      CLIUtils.info(`Daemon log file: ${daemonLogFile}`);

      const daemon = new AgentDogDaemon({
        configPath: this.configManager.getConfigPath(),
        webPort,
        pidFile
      });

      // Set up signal handling
      process.on('SIGINT', async () => {
        CLIUtils.info('Received stop signal, shutting down daemon...');
        await daemon.stop();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await daemon.stop();
        process.exit(0);
      });

      await daemon.start();

      // Always start web server now (default behavior)
      try {
        await daemon.startWebServer(webPort);
        CLIUtils.success(`Web interface started: http://localhost:${webPort}`);
      } catch (error) {
        // If the detected port is not available, try to find another one
        if ((error as Error).message.includes('EADDRINUSE')) {
          CLIUtils.warn(`Port ${webPort} is not available, trying to find another port...`);
          const newPort = await this.findAvailablePort(webPort + 1);
          await daemon.startWebServer(newPort);
          CLIUtils.success(`Web interface started: http://localhost:${newPort}`);
          webPort = newPort;
        } else {
          throw error;
        }
      }

      CLIUtils.success(`AgentDog daemon started (PID: ${process.pid})`);
      CLIUtils.info(`Web interface: http://localhost:${webPort}`);
      CLIUtils.info(`Config file: ${this.configManager.getConfigPath()}`);
      CLIUtils.info('Press Ctrl+C to stop daemon');

      // Keep process running
      await new Promise(() => {});
      
    } catch (error) {
      CLIUtils.error('Failed to start daemon:', (error as Error).message);
      process.exit(1);
    }
  }

  async stop(args: string[], options: any): Promise<void> {
    const pidFile = options['pid-file'] || this.getDefaultPidFile();

    try {
      const pid = await this.getPidFromFile(pidFile);
      if (!pid) {
        CLIUtils.error('No running daemon found');
        process.exit(1);
      }

      await this.stopDaemonByPid(pid);

      // Clean up PID file
      try {
        await fs.unlink(pidFile);
      } catch (error) {
        // Ignore errors
      }

      CLIUtils.success('Daemon stopped');

    } catch (error) {
      CLIUtils.error('Failed to stop daemon:', (error as Error).message);
      process.exit(1);
    }
  }

  // 重启 daemon：先停掉正在运行的实例（若有），再按 start 流程启动
  async restart(args: string[], options: any): Promise<void> {
    const pidFile = options['pid-file'] || this.getDefaultPidFile();

    const info = await this.getDaemonInfoFromFile(pidFile);
    if (info) {
      let running = false;
      try {
        process.kill(info.pid, 0);
        running = true;
      } catch {
        running = false;
      }
      if (running) {
        CLIUtils.info(`Stopping daemon (PID: ${info.pid})...`);
        await this.stopDaemonByPid(info.pid);
        try {
          await fs.unlink(pidFile);
        } catch {
          // PID 文件不存在则忽略
        }
        CLIUtils.success('Daemon stopped');
      }
    }

    await this.start(args, options);
  }

  // 停止指定 PID 的 daemon：SIGTERM 优雅退出，超时 SIGKILL 兜底
  private async stopDaemonByPid(pid: number): Promise<void> {
    process.kill(pid, 'SIGTERM');

    let attempts = 0;
    while (attempts < 30) {
      try {
        process.kill(pid, 0); // Check if process still exists
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      } catch (error) {
        // Process has stopped
        break;
      }
    }

    if (attempts >= 30) {
      CLIUtils.warn('Daemon did not stop within expected time, forcing termination...');
      process.kill(pid, 'SIGKILL');
    }
  }

  async status(args: string[], options: any): Promise<void> {
    if (options['daemon-port']) {
      CLIUtils.error('--daemon-port has been removed: daemon IPC has been merged into the Web port.');
      process.exit(1);
    }

    await this.configManager.loadConfig();
    const port = this.configManager.getWebPort() ?? 61125;

    try {
      // 旧 status 有 5s 超时；新客户端 requestTimeoutMs 默认 120s，对 CLI 状态查询过长，显式收窄。
      // connectAttempts/connectIntervalMs 仅在调 connect() 时生效，此处未调，无需传。
      const client = new DaemonClient({
        baseUrl: `http://localhost:${port}`,
        clientType: 'cli',
        silent: true,
        requestTimeoutMs: 5000
      });

      const status = await client.getStatus();
      this.displayFriendlyStatus(status, port);
      process.exit(0);
    } catch (error) {
      this.displayConnectionError(error as Error, port);
    }
  }

  private displayFriendlyStatus(status: any, port: number): void {
    const daemon = status.daemon || {};
    const mcpServer = status.mcpServer || {};
    const servers = status.servers || [];

    console.log(`
✅ ${CLIUtils.colorize('AgentDog daemon is running', 'green')}

${CLIUtils.colorize('Daemon Info:', 'cyan')}
  🌐 Web port: ${port}
  ⏱️  Uptime: ${this.formatUptime(daemon.uptime || 0)}
  👥 Connected clients: ${daemon.clients?.length || 0}

${CLIUtils.colorize('MCP Server Status:', 'cyan')}
  🚀 Initialized: ${mcpServer.initialized ? '✅ Yes' : '❌ No'}
  🎯 Client: ${mcpServer.client?.clientName || 'Unknown'} v${mcpServer.client?.clientVersion || 'Unknown'}

${CLIUtils.colorize('MCP Servers:', 'cyan')}`);

    if (servers.length === 0) {
      console.log('  📭 No MCP servers configured');
    } else {
      servers.forEach((server: any) => {
        const status = server.connected ? '✅' : '❌';
        const toolCount = server.toolCount || 0;
        console.log(`  ${status} ${server.name} (${toolCount} tools)`);
      });
    }

    if (daemon.clients && daemon.clients.length > 0) {
      console.log(`\n${CLIUtils.colorize('Active Clients:', 'cyan')}`);
      daemon.clients.forEach((client: any) => {
        const lastSeen = new Date(client.lastSeen);
        const timeDiff = Math.round((Date.now() - lastSeen.getTime()) / 1000);
        console.log(`  📱 ${client.type} (last active: ${timeDiff}s ago)`);
      });
    }

    console.log(`
${CLIUtils.colorize('Management:', 'cyan')}
  🌐 Web interface: Check with 'agentdog start --web-port 61125'
  🔄 Reload config: agentdog daemon reload
  🛑 Stop daemon: agentdog stop
`);
  }

  private displayConnectionError(error: Error, port: number): void {
    console.log(`
❌ ${CLIUtils.colorize('Cannot connect to AgentDog daemon', 'red')}

${CLIUtils.colorize('Connection Details:', 'yellow')}
  • Port: ${port}
  • Error: ${error.message}

${CLIUtils.colorize('Possible Solutions:', 'yellow')}
  1. Start the daemon:
     agentdog start --config your-config.json

  2. Check if daemon is running:
     ps aux | grep agentdog

  3. Check web port conflicts:
     lsof -i :${port}

${CLIUtils.colorize('Quick Start:', 'cyan')}
  agentdog start --config simple-config.json --web-port 61125
`);
    process.exit(1);
  }

  private formatUptime(seconds: number): string {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
      const minutes = Math.round(seconds / 60);
      return `${minutes}m`;
    } else {
      const hours = Math.round(seconds / 3600);
      const minutes = Math.round((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  }

  async reload(args: string[], options: any): Promise<void> {
    if (options['daemon-port']) {
      CLIUtils.error('--daemon-port has been removed: daemon IPC has been merged into the Web port.');
      process.exit(1);
    }

    await this.configManager.loadConfig();
    const port = this.configManager.getWebPort() ?? 61125;

    try {
      const client = new DaemonClient({
        baseUrl: `http://localhost:${port}`,
        clientType: 'cli',
        silent: true,
        requestTimeoutMs: 5000
      });

      await client.reloadConfig();
      CLIUtils.success('Configuration reload requested');
      process.exit(0);
    } catch (error) {
      CLIUtils.error('Failed to connect to daemon:', (error as Error).message);
      process.exit(1);
    }
  }

  // 读取 PID 文件，兼容两种格式：
  // 新格式：{"pid":123,"version":"1.0.4"}（含版本号，用于升级检测）
  // 旧格式：纯数字 PID（无版本信息）
  private async getDaemonInfoFromFile(pidFile: string): Promise<{ pid: number; version: string | null } | null> {
    return readDaemonInfo(pidFile);
  }

  private async getPidFromFile(pidFile: string): Promise<number | null> {
    const info = await this.getDaemonInfoFromFile(pidFile);
    return info?.pid ?? null;
  }

  // 读取当前包版本号（src/cli/commands 与 dist/cli/commands 均为三层到包根）
  private readPackageVersion(): string {
    try {
      const packagePath = path.join(__dirname, '../../../package.json');
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
      return packageJson.version || 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  getCommands() {
    return {
      'daemon:start': {
        description: 'Start AgentDog daemon',
        handler: this.start.bind(this),
        options: {
          'web-port': 'Enable Web interface port',
          'pid-file': 'PID file path'
        }
      },
      'daemon:stop': {
        description: 'Stop AgentDog daemon',
        handler: this.stop.bind(this),
        options: {
          'pid-file': 'PID file path'
        }
      },
      'daemon:restart': {
        description: 'Restart AgentDog daemon',
        handler: this.restart.bind(this),
        options: {
          'web-port': 'Enable Web interface port',
          'pid-file': 'PID file path'
        }
      },
      'daemon:status': {
        description: 'Check daemon status',
        handler: this.status.bind(this),
        options: {}
      },
      'daemon:reload': {
        description: 'Reload daemon configuration',
        handler: this.reload.bind(this),
        options: {}
      }
    };
  }
}