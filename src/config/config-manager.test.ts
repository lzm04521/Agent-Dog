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

    it('无 web 配置时 getWebHost 返回 localhost', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({ version: '2.0.0', servers: {} }));
      await configManager.loadConfig();
      expect(configManager.getWebHost()).toBe('localhost');
    });

    it('配置含 web.host 时 getWebHost 返回该值', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({
        version: '2.0.0',
        servers: {},
        web: { enabled: true, port: 61234, host: '0.0.0.0' }
      }));
      await configManager.loadConfig();
      expect(configManager.getWebHost()).toBe('0.0.0.0');
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

  describe('AI gateway config', () => {
    const baseProvider = {
      id: 'g1',
      slug: 'deepseek',
      dialect: 'openai' as const,
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'k',
      enabled: true,
    };

    it('老配置无 aiGateway 段时 getAIGatewayConfig 返回 undefined、providers 为空', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({ version: '2.0.0', servers: {} }));
      await configManager.loadConfig();
      expect(configManager.getAIGatewayConfig()).toBeUndefined();
      expect(configManager.getAIProviders()).toEqual([]);
    });

    it('addAIProvider 校验 slug 唯一', () => {
      expect(configManager.addAIProvider({ ...baseProvider })).toBe(true);
      expect(configManager.addAIProvider({ ...baseProvider, id: 'g2' })).toBe(false);
      expect(configManager.getAIProviderBySlug('deepseek')?.id).toBe('g1');
    });

    it('addAIProvider 校验 slug 格式', () => {
      expect(configManager.addAIProvider({ ...baseProvider, slug: 'Bad_Slug' })).toBe(false);
      expect(configManager.addAIProvider({ ...baseProvider, slug: '-bad' })).toBe(false);
      expect(configManager.addAIProvider({ ...baseProvider, slug: 'a-b2' })).toBe(true);
    });

    it('addAIProvider 落盘并发事件', async () => {
      const events: string[] = [];
      configManager.on('ai-providers-changed', () => events.push('changed'));
      configManager.addAIProvider({ ...baseProvider });
      await new Promise(r => setImmediate(r)); // 落盘为异步，flush 后断言
      const saveCall = vi.mocked(fsPromises.writeFile).mock.calls.find(c => c[0] === '/fake/path/mcpdog.config.json');
      expect(saveCall).toBeDefined();
      expect(JSON.parse(saveCall![1] as string).providers).toHaveLength(1);
      expect(events).toHaveLength(1);
    });

    it('updateAIProvider 按 id 更新、apiKey 空串不覆盖', () => {
      configManager.addAIProvider({ ...baseProvider });
      expect(configManager.updateAIProvider('g1', { name: '深度求索', apiKey: '' })).toBe(true);
      const p = configManager.getAIProviderBySlug('deepseek');
      expect(p?.name).toBe('深度求索');
      expect(p?.apiKey).toBe('k');
      expect(configManager.updateAIProvider('nope', { name: 'x' })).toBe(false);
    });

    it('updateAIProvider 改 slug 校验唯一', () => {
      configManager.addAIProvider({ ...baseProvider });
      configManager.addAIProvider({ ...baseProvider, id: 'g2', slug: 'other' });
      expect(configManager.updateAIProvider('g2', { slug: 'deepseek' })).toBe(false);
      expect(configManager.updateAIProvider('g2', { slug: 'renamed' })).toBe(true);
    });

    it('removeAIProvider 删除并落盘', () => {
      configManager.addAIProvider({ ...baseProvider });
      expect(configManager.removeAIProvider('g1')).toBe(true);
      expect(configManager.getAIProviders()).toHaveLength(0);
      expect(configManager.removeAIProvider('g1')).toBe(false);
    });

    it('setAIGateway 保存配置', async () => {
      await configManager.setAIGateway({ enabled: true, port: 62125, host: '127.0.0.1', apiKey: 'ad-sk-1' });
      expect(configManager.getAIGatewayConfig()).toEqual({ enabled: true, port: 62125, host: '127.0.0.1', apiKey: 'ad-sk-1' });
      const saveCall = vi.mocked(fsPromises.writeFile).mock.calls.find(c => c[0] === '/fake/path/mcpdog.config.json');
      expect(JSON.parse(saveCall![1] as string).aiGateway).toBeDefined();
    });
  });
});
