import { describe, it, expect, afterEach } from 'vitest';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { ConfigManager } from './config-manager';

/**
 * 真实文件系统行为测试（不 mock fs）：
 * 验证 watchConfig 在文件变更后发出 'config-updated' 事件（daemon/MCPDogServer 监听的事件名）。
 * 历史缺陷：这里曾 emit 'configChanged'，与监听者不匹配，导致直接编辑配置文件 daemon 永不重载。
 */
describe('ConfigManager file watching', () => {
  const tmpFiles: string[] = [];

  const writeConfig = (file: string, serverName?: string): void => {
    const config = {
      servers: serverName
        ? { [serverName]: { name: serverName, transport: 'stdio', command: 'node', args: ['x.js'] } }
        : {},
      version: '2.0.0'
    };
    fsSync.writeFileSync(file, JSON.stringify(config));
  };

  const makeTmpConfig = (): string => {
    const file = path.join(os.tmpdir(), `mcpdog-watch-test-${Date.now()}-${process.pid}-${tmpFiles.length}.json`);
    writeConfig(file);
    tmpFiles.push(file);
    return file;
  };

  afterEach(() => {
    for (const file of tmpFiles.splice(0)) {
      try {
        fsSync.unlinkSync(file);
      } catch {
        // 文件可能已被清理
      }
    }
  });

  it('emits config-updated when the watched config file changes', async () => {
    const file = makeTmpConfig();
    const manager = new ConfigManager(file, false);
    await manager.loadConfig();

    const events: Array<{ config: { servers: Record<string, unknown> } }> = [];
    manager.on('config-updated', (data: { config: { servers: Record<string, unknown> } }) => events.push(data));

    // startWatching 内部是持续到 abort 的 async 循环，不能 await
    void manager.startWatching();
    writeConfig(file, 'demo');

    // 留足 fs.watch 事件传播 + 300ms 防抖时间
    await new Promise(resolve => setTimeout(resolve, 1500));
    manager.stopWatching();

    expect(events.length).toBeGreaterThan(0);
    expect(Object.keys(events[0].config.servers)).toContain('demo');
  });

  it('merges multiple rapid change events into a single reload', async () => {
    const file = makeTmpConfig();
    const manager = new ConfigManager(file, false);
    await manager.loadConfig();

    const events: unknown[] = [];
    manager.on('config-updated', (data: unknown) => events.push(data));

    // startWatching 内部是持续到 abort 的 async 循环，不能 await
    void manager.startWatching();
    // 防抖窗口内连续三次写入，应合并为一次重载
    writeConfig(file, 'a');
    writeConfig(file, 'b');
    writeConfig(file, 'c');

    await new Promise(resolve => setTimeout(resolve, 1500));
    manager.stopWatching();

    expect(events.length).toBe(1);
  });
});
