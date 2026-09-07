/**
 * MCPDog Daemon
 * Unified management of MCP servers, supporting multiple client access modes
 */

import { EventEmitter } from 'events';
import { Server as HttpServer } from 'http';
import { MCPDogServer } from '../core/mcpdog-server.js';
import { ConfigManager } from '../config/config-manager.js';
import { StreamableHttpMCPServer } from '../streamable-http-server.js';
import { AiGatewayServer } from '../ai-gateway/gateway-server.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DaemonConfig {
  configPath: string;
  dashboardPort?: number;
  httpPort?: number;
  enableHttp?: boolean;
  enableStdio?: boolean;
  pidFile?: string;
  // backward compatibility
  webPort?: number;
}

export class MCPDogDaemon extends EventEmitter {
  private mcpServer: MCPDogServer;
  private configManager: ConfigManager;
  private webServer?: HttpServer;
  private httpMCPServer?: StreamableHttpMCPServer;
  private aiGateway?: AiGatewayServer;
  // HTTP 模式下的客户端活跃记录（替代原 IPC socket 注册表）
  private clientInfos = new Map<string, { type: string; lastSeen: Date }>();
  private config: DaemonConfig;
  private isRunning = false;

  constructor(config: DaemonConfig) {
    super();
    this.config = config;
    this.configManager = new ConfigManager(config.configPath);
    this.mcpServer = new MCPDogServer(this.configManager);

    this.setupMCPServerEvents();
  }

  private setupMCPServerEvents() {
    // Forward MCP server events to all clients
    this.mcpServer.on('started', () => {
      this.broadcastToClients('server-started', {});
    });

    this.mcpServer.on('stopped', () => {
      this.broadcastToClients('server-stopped', {});
    });

    // Listen for individual server connection events
    this.mcpServer.on('server-connected', (data) => {
      console.log(`[DAEMON] Received server-connected event for: ${data.serverName}`);
      this.broadcastToClients('server-connected', data);
      console.log(`[DAEMON] Broadcasted server-connected event for: ${data.serverName}`);
    });

    this.mcpServer.on('server-disconnected', (data) => {
      this.broadcastToClients('server-disconnected', data);
    });

    this.mcpServer.on('server-error', (data) => {
      this.broadcastToClients('server-error', data);
    });

    this.mcpServer.on('server-log', (data) => {
      this.broadcastToClients('server-log', data);
    });

    // Listen for tool router events
    const toolRouter = this.mcpServer.getToolRouter();
    toolRouter.on('routes-updated', (data) => {
      this.broadcastToClients('routes-updated', data);
    });

    toolRouter.on('tool-called', (data) => {
      this.broadcastToClients('tool-called', data);
    });

    toolRouter.on('error', (data) => {
      this.broadcastToClients('error', data);
    });

    // Listen for config changes
    this.configManager.on('config-updated', (data) => {
      this.broadcastToClients('config-changed', data.config);
      // If it's a server toggle or tool config change, no need to restart all servers
      const changeType = data.context?.changeType;
      const serverName = data.context?.serverName;

      if (changeType === 'server-toggle') {
        console.log(`[DAEMON] Skipping full restart for server toggle: ${serverName}`);
      } else if (changeType === 'tool-toggle' || changeType === 'tool-config-update') {
        if (serverName) {
          console.log(`[DAEMON] Handling tool update for server: ${serverName}`);
          this.mcpServer.updateServerTools(serverName);
        }
      } else {
        this.handleConfigChange(data.config);
      }
    });

    // Listen for server enable/disable events
    this.configManager.on('server-toggled', (data) => {
      console.log(`[DAEMON] Server toggled: ${data.name} enabled: ${data.enabled}`);
      this.emit('server-toggled', data);
    });
  }

  private broadcastToClients(type: string, data: any) {
    // IPC socket 已删除；本地事件保留，供 daemon-web-server 的 socket.io 推送消费
    this.emit(type, data);
  }

  // HTTP 模式下由 /api/mcp 路由调用，替代原 socket 注册表的 lastSeen 记录
  recordClientActivity(clientId: string, type: string): void {
    this.clientInfos.set(clientId, { type, lastSeen: new Date() });
  }

  private getFullStatus() {
    const toolRouter = this.mcpServer.getToolRouter();
    const adapters = toolRouter.getAllAdapters();

    return {
      daemon: {
        isRunning: this.isRunning,
        clients: Array.from(this.clientInfos.entries()).map(([id, info]) => ({
          id,
          type: info.type,
          lastSeen: info.lastSeen
        })),
        uptime: process.uptime()
      },
      mcpServer: this.mcpServer.getStatus(),
      servers: adapters.map(adapter => ({
        name: adapter.name,
        connected: adapter.isConnected,
        toolCount: toolRouter.getToolsByServer(adapter.name).length,
        enabledToolCount: toolRouter.getEnabledToolsByServer(adapter.name).length,
        config: adapter.config
      }))
    };
  }

  private async handleConfigChange(config: any) {
    console.log('[DAEMON] Config changed, reloading servers...');
    // Reinitialize servers
    await this.mcpServer.stop();
    await this.mcpServer.start();
    
    this.broadcastToClients('status-update', this.getFullStatus()); // Explicitly broadcast status after server restart
  }

  private async initializeMCPServer() {
    // Simulate MCP client's initialize request to initialize the server
    const initializeRequest = {
      jsonrpc: '2.0' as const,
      id: 'daemon-init',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: { listChanged: false }
        },
        clientInfo: {
          name: 'MCPDog Daemon',
          version: '2.0.0'
        }
      }
    };

    try {
      await this.mcpServer.handleRequest(initializeRequest, 'daemon-init');
      console.log('[DAEMON] MCP Server initialized successfully');
    } catch (error) {
      console.error('[DAEMON] Failed to initialize MCP Server:', error);
    }
  }

  private async reloadConfig() {
    console.log('[DAEMON] Manual config reload requested');
    await this.configManager.loadConfig();
    
    // Re-initialize MCP server to connect to new servers
    try {
      await this.mcpServer.handleConfigReload();
      console.log('[DAEMON] MCP Server reinitialized after config reload');
    } catch (error) {
      console.error('[DAEMON] Failed to reinitialize MCP Server after config reload:', error);
    }
  }

  private async handleConfigRequest(message: any) {
    const { action, serverName, toolName, enabled } = message;

    switch (action) {
      case 'toggle-tool':
        await this.configManager.toggleTool(serverName, toolName, enabled);
        break;
      // Add other config actions here
      default:
        console.warn(`[DAEMON] Unknown config action: ${action}`);
    }
  }

  async start(): Promise<void> {
    try {
      console.log('[DAEMON] Starting MCPDog daemon...');
      
      // Load config file
      await this.configManager.loadConfig();
      
      // Start MCP server
      await this.mcpServer.start();
      
      // In daemon mode, manually initialize MCP server
      await this.initializeMCPServer();

      // Start HTTP MCP server if enabled
      if (this.config.enableHttp && this.config.httpPort) {
        try {
          // Get auth token from environment variable
          const authToken = process.env.MCPDOG_AUTH_TOKEN;
          this.httpMCPServer = new StreamableHttpMCPServer(this.configManager, this.config.httpPort, authToken);
          await this.httpMCPServer.start();
          console.log(`[DAEMON] HTTP MCP server started on port ${this.config.httpPort}${authToken ? ' with authentication' : ''}`);
        } catch (error) {
          console.error(`[DAEMON] Failed to start HTTP MCP server on port ${this.config.httpPort}:`, error);
          // HTTP transport is optional, continue without it
        }
      }

      // AI API 网关（可选，aiGateway.enabled 才启动）
      const gatewayConfig = this.configManager.getAIGatewayConfig();
      if (gatewayConfig?.enabled) {
        try {
          this.aiGateway = new AiGatewayServer(this.configManager);
          await this.aiGateway.start();
        } catch (error) {
          console.error('[DAEMON] Failed to start AI gateway:', error);
          // 网关可选，不阻塞 daemon 启动
          this.aiGateway = undefined;
        }
      }

      // Write PID file（含版本号，供 daemon start 检测版本差异自动升级重启）
      if (this.config.pidFile) {
        let version = 'unknown';
        try {
          const pkg = JSON.parse(await fs.readFile(path.join(__dirname, '../../package.json'), 'utf-8'));
          if (pkg.version) version = pkg.version;
        } catch {
          // 版本读取失败不阻塞启动
        }
        await fs.writeFile(this.config.pidFile, JSON.stringify({ pid: process.pid, version }));
      }

      this.isRunning = true;
      console.log('[DAEMON] MCPDog daemon started successfully');
      
    } catch (error) {
      console.error('[DAEMON] Failed to start daemon:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      console.log('[DAEMON] Stopping MCPDog daemon...');
      
      this.isRunning = false;

      // Stop AI gateway first
      if (this.aiGateway) {
        try {
          await this.aiGateway.stop();
        } catch (error) {
          console.error('[DAEMON] Error stopping AI gateway:', error);
        }
        this.aiGateway = undefined;
      }

      // Stop HTTP MCP server if running
      if (this.httpMCPServer) {
        try {
          // StreamableHttpMCPServer doesn't have a direct stop method,
          // but it should clean up on process exit
          console.log('[DAEMON] HTTP MCP server stopped');
        } catch (error) {
          console.error('[DAEMON] Error stopping HTTP MCP server:', error);
        }
      }

      // Stop MCP server
      await this.mcpServer.stop();

      // Clean up PID file
      if (this.config.pidFile) {
        try {
          await fs.unlink(this.config.pidFile);
        } catch (error) {
          // PID file might have already been deleted, ignore error
        }
      }

      console.log('[DAEMON] MCPDog daemon stopped');
      
    } catch (error) {
      console.error('[DAEMON] Error stopping daemon:', error);
      throw error;
    }
  }

  getConfigManager(): ConfigManager {
    return this.configManager;
  }

  // Web server support (optional)
  async startWebServer(port: number): Promise<void> {
    const { DaemonWebServer } = await import('./daemon-web-server.js');
    const webServer = new DaemonWebServer(this, port, this.configManager.getWebHost());
    await webServer.start();
    console.log(`[DAEMON] Web interface started on port ${port}`);
  }

  // AI gateway restart after settings change (stop → start)
  async restartAiGateway(): Promise<void> {
    if (this.aiGateway) {
      await this.aiGateway.stop();
      this.aiGateway = undefined;
    }
    const gatewayConfig = this.configManager.getAIGatewayConfig();
    if (gatewayConfig?.enabled) {
      this.aiGateway = new AiGatewayServer(this.configManager);
      await this.aiGateway.start();
    }
  }

  getAiGateway(): AiGatewayServer | undefined {
    return this.aiGateway;
  }
}