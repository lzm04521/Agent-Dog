// daemon-info 共享模块测试：PID 文件双格式解析与进程存活探测
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { readDaemonInfo, isProcessAlive } from './daemon-info.js';

describe('readDaemonInfo', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcpdog-pid-'));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('解析新格式 JSON（含版本）', async () => {
    const f = path.join(dir, 'a.pid');
    await fs.writeFile(f, '{"pid":12345,"version":"1.0.6"}', 'utf-8');
    expect(await readDaemonInfo(f)).toEqual({ pid: 12345, version: '1.0.6' });
  });

  it('解析旧格式纯数字 PID（version 为 null）', async () => {
    const f = path.join(dir, 'b.pid');
    await fs.writeFile(f, '12345', 'utf-8');
    expect(await readDaemonInfo(f)).toEqual({ pid: 12345, version: null });
  });

  it('文件不存在返回 null', async () => {
    expect(await readDaemonInfo(path.join(dir, 'none.pid'))).toBeNull();
  });

  it('空文件返回 null', async () => {
    const f = path.join(dir, 'c.pid');
    await fs.writeFile(f, '   ', 'utf-8');
    expect(await readDaemonInfo(f)).toBeNull();
  });

  it('损坏 JSON 返回 null（不抛错）', async () => {
    const f = path.join(dir, 'd.pid');
    await fs.writeFile(f, '{"pid": broken', 'utf-8');
    expect(await readDaemonInfo(f)).toBeNull();
  });

  it('JSON 但 pid 非数字返回 null', async () => {
    const f = path.join(dir, 'e.pid');
    await fs.writeFile(f, '{"pid":"abc"}', 'utf-8');
    expect(await readDaemonInfo(f)).toBeNull();
  });

  it('JSON 缺 version 字段时 version 为 null', async () => {
    const f = path.join(dir, 'f.pid');
    await fs.writeFile(f, '{"pid":777}', 'utf-8');
    expect(await readDaemonInfo(f)).toEqual({ pid: 777, version: null });
  });
});

describe('isProcessAlive', () => {
  it('当前进程存活', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });
  it('不存在的 PID 返回 false', () => {
    expect(isProcessAlive(99999999)).toBe(false);
  });
});
