// Anthropic 格式错误响应工具：对外错误体统一 {type:"error", error:{type, message}}
import { Response } from 'express';

export function anthropicError(res: Response, status: number, type: string, message: string): void {
  res.status(status).json({ type: 'error', error: { type, message } });
}

// 上游状态码 → Anthropic 错误类型（设计文档 §7）
export function mapUpstreamStatus(status: number): string {
  if (status === 401 || status === 403) {
    return 'authentication_error';
  }
  if (status === 404) {
    return 'not_found_error';
  }
  if (status === 429) {
    return 'rate_limit_error';
  }
  return 'api_error'; // 5xx / 529 / 其他
}
