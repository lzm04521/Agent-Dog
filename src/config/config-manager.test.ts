import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigManager } from './config-manager';
import { MCPServerConfig } from '../types';
import { promises as fsPromises } from 'fs';

// Mock the file system（config-manager 经 `import { promises as fs } from 'fs'` 访问，
// mock 需同时提供 named promises 与 default.promises 两种形状）
vi.mock('fs', () => {
  const promises = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  };
  return {
    promises,
    default: { promises },
  };
});

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

describe('ConfigManager', () => {
  let configManager: ConfigManager;

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();
    configManager = new ConfigManager('/fake/path/mcpdog.config.json');
  });

  describe('updateServer', () => {
    it('should clean up endpoint when switching to stdio', () => {
      const initialConfig: MCPServerConfig = {
        name: 'test-server',
        transport: 'streamable-http',
        endpoint: 'http://localhost:8080',
        enabled: true,
      };
      configManager.addServer('test-server', initialConfig);

      const updates: Partial<MCPServerConfig> = {
        transport: 'stdio',
        command: 'npx',
        args: ['my-server'],
      };

      configManager.updateServer('test-server', updates);

      const updatedConfig = configManager.getServerConfig('test-server');
      expect(updatedConfig).toBeDefined();
      expect(updatedConfig?.transport).toBe('stdio');
      expect(updatedConfig?.command).toBe('npx');
      expect(updatedConfig).not.toHaveProperty('endpoint');
    });

    it('should clean up command and args when switching to http', () => {
      const initialConfig: MCPServerConfig = {
        name: 'test-server',
        transport: 'stdio',
        command: 'npx',
        args: ['my-server'],
        enabled: true,
      };
      configManager.addServer('test-server', initialConfig);

      const updates: Partial<MCPServerConfig> = {
        transport: 'streamable-http',
        endpoint: 'http://localhost:8080',
      };

      configManager.updateServer('test-server', updates);

      const updatedConfig = configManager.getServerConfig('test-server');
      expect(updatedConfig).toBeDefined();
      expect(updatedConfig?.transport).toBe('streamable-http');
      expect(updatedConfig?.endpoint).toBe('http://localhost:8080');
      expect(updatedConfig).not.toHaveProperty('command');
      expect(updatedConfig).not.toHaveProperty('args');
    });

    it('should not clean up fields if transport is not changed', () => {
      const initialConfig: MCPServerConfig = {
        name: 'test-server',
        transport: 'stdio',
        command: 'npx',
        args: ['my-server'],
        enabled: true,
      };
      configManager.addServer('test-server', initialConfig);

      const updates: Partial<MCPServerConfig> = {
        command: 'npm',
      };

      configManager.updateServer('test-server', updates);

      const updatedConfig = configManager.getServerConfig('test-server');
      expect(updatedConfig).toBeDefined();
      expect(updatedConfig?.transport).toBe('stdio');
      expect(updatedConfig?.command).toBe('npm');
      expect(updatedConfig?.args).toEqual(['my-server']);
    });
  });

  describe('web port persistence', () => {
    it('无 web 配置时 getWebPort 返回 null', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({ version: '2.0.0', servers: {} }));
      await configManager.loadConfig();
      expect(configManager.getWebPort()).toBeNull();
    });

    it('配置含 web.port 时 getWebPort 返回该值', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({
        version: '2.0.0',
        servers: {},
        web: { enabled: true, port: 61234, host: 'localhost' }
      }));
      await configManager.loadConfig();
      expect(configManager.getWebPort()).toBe(61234);
    });

    it('setWebPort 首次设置创建 web 字段并落盘', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({ version: '2.0.0', servers: {} }));
      await configManager.loadConfig();

      await configManager.setWebPort(61125);

      expect(configManager.getWebPort()).toBe(61125);
      // 按 saveConfig 的目标路径取调用（shouldAutoCreateConfig 的探测写也走 writeFile，不能按序号取）
      const saveCall = vi.mocked(fsPromises.writeFile).mock.calls.find(c => c[0] === '/fake/path/mcpdog.config.json');
      expect(saveCall).toBeDefined();
      const saved = JSON.parse(saveCall![1] as string);
      expect(saved.web).toEqual({ enabled: true, port: 61125, host: 'localhost' });
    });

    it('setWebPort 覆盖已有 web.port', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({
        version: '2.0.0',
        servers: {},
        web: { enabled: true, port: 61234, host: 'localhost' }
      }));
      await configManager.loadConfig();

      await configManager.setWebPort(61125);

      expect(configManager.getWebPort()).toBe(61125);
      const saveCall = vi.mocked(fsPromises.writeFile).mock.calls.find(c => c[0] === '/fake/path/mcpdog.config.json');
      expect(saveCall).toBeDefined();
      const saved = JSON.parse(saveCall![1] as string);
      expect(saved.web.port).toBe(61125);
    });
  });
});
