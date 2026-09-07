// daemon PID 文件共享读取：proxy-command 与 daemon-commands 统一复用，
// 消除双实现漂移（曾因 proxy 侧 parseInt 解析 JSON 格式导致存活检测恒失败）
// 新格式：{"pid":123,"version":"1.0.4"}（含版本号，用于升级检测）
// 旧格式：纯数字 PID（无版本信息）
import { promises as fs } from 'fs';

export interface DaemonInfo {
  pid: number;
  version: string | null;
}

export async function readDaemonInfo(pidFile: string): Promise<DaemonInfo | null> {
  try {
    const content = (await fs.readFile(pidFile, 'utf-8')).trim();
    if (!content) return null;

    if (content.startsWith('{')) {
      const info = JSON.parse(content);
      if (typeof info.pid === 'number') {
        return { pid: info.pid, version: info.version ?? null };
      }
      return null;
    }

    const pid = parseInt(content);
    return isNaN(pid) ? null : { pid, version: null };
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // 信号 0 仅探测进程存在性
    return true;
  } catch {
    return false;
  }
}
