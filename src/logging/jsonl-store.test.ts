import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { JsonlStore } from './jsonl-store.js';

// 测试隔离：每个用例独立临时目录，不触碰 ~/.agentdog/logs
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentdog-jsonl-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('JsonlStore', () => {
  it('append 写入内存缓冲并落盘为 JSON 行', async () => {
    const store = new JsonlStore({ filePath: join(dir, 'a.jsonl'), maxEntries: 10 });
    store.append({ id: 1, msg: 'hello' });
    await store.ready();

    expect(store.recent()).toEqual([{ id: 1, msg: 'hello' }]);

    const text = await readFile(join(dir, 'a.jsonl'), 'utf8');
    expect(text).toBe('{"id":1,"msg":"hello"}\n');
  });

  it('append 触发 append 事件（daemon-web-server 据此 socket 推送）', async () => {
    const store = new JsonlStore({ filePath: join(dir, 'a.jsonl'), maxEntries: 10 });
    const seen: unknown[] = [];
    store.on('append', (line) => seen.push(line));

    store.append({ n: 1 });
    store.append({ n: 2 });
    await store.ready(); // ready 等待写盘队列排空

    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('超过 maxEntries 时内存环形截断，保留最新', async () => {
    const store = new JsonlStore({ filePath: join(dir, 'a.jsonl'), maxEntries: 3 });
    for (let i = 1; i <= 5; i++) {
      store.append({ n: i });
    }
    await store.ready();

    expect(store.recent().map((l: any) => l.n)).toEqual([3, 4, 5]);
  });

  it('并发 append 落盘行序保持（写盘串行队列）', async () => {
    const store = new JsonlStore({ filePath: join(dir, 'a.jsonl'), maxEntries: 100 });
    for (let i = 1; i <= 20; i++) {
      store.append({ n: i });
    }
    await store.ready();

    const text = await readFile(join(dir, 'a.jsonl'), 'utf8');
    const ns = text.trim().split('\n').map((l) => JSON.parse(l).n);
    expect(ns).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('同一文件重新实例化时加载尾部历史（daemon 重启恢复）', async () => {
    const first = new JsonlStore({ filePath: join(dir, 'a.jsonl'), maxEntries: 10 });
    for (let i = 1; i <= 4; i++) {
      first.append({ n: i });
    }
    await first.ready();

    const second = new JsonlStore({ filePath: join(dir, 'a.jsonl'), maxEntries: 3 });
    await second.ready();

    expect(second.recent().map((l: any) => l.n)).toEqual([2, 3, 4]);
  });

  it('启动前已存在的文件计入轮转字节阈值，超限轮转为 .1', async () => {
    const path = join(dir, 'rot.jsonl');
    await writeFile(path, 'x'.repeat(600), 'utf8'); // 预置 600 字节

    const store = new JsonlStore({ filePath: path, maxEntries: 10, rotateBytes: 1024 });
    await store.ready();

    store.append({ big: 'y'.repeat(500) }); // 600 + 500 ≥ 1024 → 触发轮转
    await new Promise((r) => setTimeout(r, 100));

    await access(path); // 轮转后新文件已重建
    const rotated = await readFile(path + '.1', 'utf8');
    expect(rotated).toBe('x'.repeat(600)); // 旧内容完整进入 .1
    const fresh = await readFile(path, 'utf8');
    expect(fresh).toContain('"big"'); // 新行写入新文件
  });

  it('文件不存在时首次 append 自动创建目录与文件', async () => {
    const path = join(dir, 'nested', 'deep', 'a.jsonl');
    const store = new JsonlStore({ filePath: path, maxEntries: 5 });
    store.append({ ok: true });
    await store.ready();

    const text = await readFile(path, 'utf8');
    expect(text).toBe('{"ok":true}\n');
  });

  it('加载时跳过损坏行（半行 JSON）', async () => {
    const path = join(dir, 'a.jsonl');
    await writeFile(path, '{"n":1}\n{"n":2}\n{"broken": ', 'utf8');

    const store = new JsonlStore({ filePath: path, maxEntries: 10 });
    await store.ready();

    expect(store.recent().map((l: any) => l.n)).toEqual([1, 2]);
  });
});
