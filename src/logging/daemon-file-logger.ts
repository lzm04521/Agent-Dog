import fsSync from 'fs';
import path from 'path';
import os from 'os';

let installed = false;

/**
 * 将 daemon 进程的全部 stdout/stderr 输出同步落盘到 ~/.mcpdog/daemon-YYYYMMDD.log。
 *
 * daemon 由 MCP 客户端经 detached + stdio:'ignore' 方式拉起，console 输出默认被丢弃，
 * 不落盘时线上排障没有任何日志可查。tee 到原始流保证前台手动运行时终端输出不受影响。
 * 按天命名文件，daemon 重启后自动写入新文件；不中断已运行进程的输出。
 *
 * @returns 日志文件绝对路径；重复调用只生效一次
 */
export function startDaemonFileLogging(mcpdogDir?: string): string {
  if (installed) {
    return getDaemonLogFile(mcpdogDir);
  }
  installed = true;

  const dir = mcpdogDir || path.join(os.homedir(), '.mcpdog');
  try {
    fsSync.mkdirSync(dir, { recursive: true });
  } catch {
    // 目录已存在或无法创建，写入时由 stream error 兜底
  }

  const logFile = getDaemonLogFile(dir);
  // append 模式：同一 daemon 反复拉起时保留历史；跨实例并发写入为行级追加，可接受
  const stream = fsSync.createWriteStream(logFile, { flags: 'a' });
  // 日志写失败不能影响 daemon 本身
  stream.on('error', () => {});

  const toLine = (chunk: unknown): string =>
    typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    stream.write(toLine(chunk));
    return (origStdoutWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    stream.write(toLine(chunk));
    return (origStderrWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;

  stream.write(`\n===== daemon started at ${new Date().toISOString()} (pid ${process.pid}) =====\n`);
  return logFile;
}

/**
 * 当前（或指定目录下）daemon 日志文件路径，与 startDaemonFileLogging 的命名规则一致
 */
export function getDaemonLogFile(mcpdogDir?: string): string {
  const dir = mcpdogDir || path.join(os.homedir(), '.mcpdog');
  return path.join(dir, `daemon-${new Date().toISOString().slice(0, 10)}.log`);
}
