// 共享 JSONL 追加存储：内存环形缓冲 + 文件追加 + 超限轮转 + 启动读尾部。
// MCP 日志（mcp.jsonl）与 AI 调用流水（ai-calls.jsonl）两处同构持久化的通用件。
// 日志目录可被 AGENTDOG_LOG_DIR 覆盖（测试隔离用）。
import { EventEmitter } from 'events';
import { appendFile, mkdir, readFile, rename, rm, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';

export interface JsonlStoreOptions {
  filePath: string;      // 绝对路径，父目录自动创建
  maxEntries: number;    // 内存环形缓冲上限（同时决定启动读尾条数）
  rotateBytes?: number;  // 单文件字节阈值，超出时轮转为 .1；默认 5MB
}

const DEFAULT_ROTATE_BYTES = 5 * 1024 * 1024;

export function resolveLogDir(): string {
  return process.env.AGENTDOG_LOG_DIR || join(homedir(), '.agentdog', 'logs');
}

export class JsonlStore extends EventEmitter {
  private readonly opts: Required<JsonlStoreOptions>;
  private entries: unknown[] = [];
  private bytesSinceRotate = 0;
  private initialized = false;
  private initPromise?: Promise<void>;
  // 写盘串行队列：appendFile 并发执行完成顺序不定，会导致 JSONL 行乱序
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: JsonlStoreOptions) {
    super();
    this.opts = { rotateBytes: DEFAULT_ROTATE_BYTES, ...options };
  }

  // 构造后惰性初始化（首次 append/recent 时触发），避免模块加载即做文件 IO
  private ensureInit(): Promise<void> {
    if (this.initialized) {
      return Promise.resolve();
    }
    if (!this.initPromise) {
      this.initPromise = this.init().then(() => {
        this.initialized = true;
      });
    }
    return this.initPromise;
  }

  private async init(): Promise<void> {
    try {
      await mkdir(dirname(this.opts.filePath), { recursive: true });
      const [buffer, stats] = await Promise.all([
        readFile(this.opts.filePath).catch(() => null),
        stat(this.opts.filePath).catch(() => null),
      ]);
      if (stats) {
        this.bytesSinceRotate = stats.size;
      }
      if (buffer) {
        const tail: unknown[] = [];
        for (const line of buffer.toString('utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            tail.push(JSON.parse(line));
          } catch {
            // 半行/损坏行跳过（如进程写入中途被杀）
          }
        }
        // init 期间可能已有新行 append 进来（内存先行、落盘在 init 后），合并保留
        this.entries = [...tail, ...this.entries].slice(-this.opts.maxEntries);
      }
    } catch (error) {
      // 读历史失败不阻断服务：缓冲从空开始，新日志照常追加
      console.error(`[JSONL-STORE] Failed to load ${this.opts.filePath}:`, (error as Error).message);
    }
  }

  append(line: unknown): void {
    this.entries.push(line);
    if (this.entries.length > this.opts.maxEntries) {
      this.entries.splice(0, this.entries.length - this.opts.maxEntries);
    }
    this.emit('append', line);

    const text = JSON.stringify(line) + '\n';
    this.bytesSinceRotate += Buffer.byteLength(text, 'utf8');
    this.writeQueue = this.writeQueue.then(() => this.write(text));
  }

  private async write(text: string): Promise<void> {
    try {
      await this.ensureInit();
      if (this.bytesSinceRotate >= this.opts.rotateBytes) {
        // 轮转：先删旧 .1 再改名（Windows rename 不覆盖已存在文件）
        const rotated = this.opts.filePath + '.1';
        await rm(rotated, { force: true });
        await rename(this.opts.filePath, rotated);
        this.bytesSinceRotate = Buffer.byteLength(text, 'utf8');
      }
      await appendFile(this.opts.filePath, text, 'utf8');
    } catch (error) {
      // 落盘失败不抛出：日志持久化失败不能拖垮转发请求，仅上报
      console.error(`[JSONL-STORE] Failed to append ${this.opts.filePath}:`, (error as Error).message);
      this.emit('write-error', error);
    }
  }

  async ready(): Promise<unknown[]> {
    await this.ensureInit();
    await this.writeQueue; // 等待积压写盘完成，调用方可确定性读取
    return this.entries;
  }

  recent(limit?: number): unknown[] {
    if (limit && limit > 0) {
      return this.entries.slice(-limit);
    }
    return [...this.entries];
  }
}
