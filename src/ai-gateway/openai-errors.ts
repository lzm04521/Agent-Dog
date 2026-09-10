// src/ai-gateway/openai-errors.ts
// OpenAI 格式错误响应工具：对外错误体统一 {error:{message, type, code?}}（设计文档 §4.6）
import { Response } from 'express';

export function openaiError(res: Response, status: number, type: string, message: string, code?: string): void {
  res.status(status).json({
    error: {
      message,
      type,
      ...(code ? { code } : {}),
    },
  });
}

// 上游状态码 → OpenAI 错误类型/code（对称 anthropic-errors.mapUpstreamStatus）
export function mapUpstreamStatusToOpenAI(status: number): { type: string; code?: string } {
  if (status === 401 || status === 403) {
    return { type: 'invalid_request_error', code: 'invalid_api_key' };
  }
  if (status === 404) {
    return { type: 'invalid_request_error', code: 'model_not_found' };
  }
  if (status === 429) {
    return { type: 'rate_limit_error' };
  }
  return { type: 'api_error' };
}
