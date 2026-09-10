// AI 调用流水：网关请求生命周期埋点 → 环形缓冲 + JSONL 落盘 + append 事件
// （daemon-web-server 订阅事件转 socket.io 'ai-log' 推送）。
// 埋点协议：入口 handler 调 beginCallLog 挂 res.locals.callLog 并注册 finish/close 统一 finalize；
// 转发通道（passthrough / ir-channel / count-tokens）通过 patchCallLog 补 usage 与失败摘要。
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { AiCallLog } from '../types/index.js';
import { JsonlStore, resolveLogDir } from '../logging/jsonl-store.js';
import { join } from 'path';

const EXCERPT_CHARS = 500;
const MAX_RECENT = 200;

// 惰性单例：首次使用时才解析 AGENTDOG_LOG_DIR（测试隔离在用例前设 env 即可生效）
let store: JsonlStore | undefined;

export function getAiCallStore(): JsonlStore {
  if (!store) {
    store = new JsonlStore({
      filePath: join(resolveLogDir(), 'ai-calls.jsonl'),
      maxEntries: MAX_RECENT,
    });
  }
  return store;
}

// 仅供测试：重置惰性单例，让下一个用例用新的 AGENTDOG_LOG_DIR 重新初始化
export function resetAiCallStoreForTests(): void {
  store = undefined;
}

interface CallLogContext {
  call: AiCallLog;
  startedAt: number;
  finalized: boolean;
}

function ctxOf(res: Response): CallLogContext | undefined {
  if (!res.locals) return undefined; // 非标准 Response（测试 mock）无埋点上下文，静默跳过
  return (res.locals as { callLog?: CallLogContext }).callLog;
}

export function beginCallLog(
  res: Response,
  init: { ingress: 'anthropic' | 'openai'; path: string; model: string }
): void {
  const call: AiCallLog = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ingress: init.ingress,
    path: init.path,
    model: init.model,
    providerName: '',
    upstreamModel: '',
    status: 0,
    durationMs: 0,
  };
  if (!res.locals) {
    res.locals = {};
  }
  (res.locals as { callLog?: CallLogContext }).callLog = { call, startedAt: Date.now(), finalized: false };

  // 响应结束（正常完成或断连）统一在此落一条流水；finalized 防两事件重复触发
  res.on('finish', () => finalizeCallLog(res, {}));
  res.on('close', () => {
    if (!res.headersSent) {
      finalizeCallLog(res, { status: 499 }); // 客户端断连（请求未完成）
    } else {
      finalizeCallLog(res, {});
    }
  });
}

export function patchCallLog(res: Response, patch: Partial<AiCallLog>): void {
  const ctx = ctxOf(res);
  if (!ctx) return;
  const { usage, ...rest } = patch;
  if (usage) {
    // 流式场景 usage 分多帧到达（input 先于 output），合并而非覆盖
    ctx.call.usage = { ...ctx.call.usage, ...usage };
  }
  Object.assign(ctx.call, rest);
}

export function finalizeCallLog(res: Response, patch: Partial<AiCallLog>): void {
  const ctx = ctxOf(res);
  if (!ctx || ctx.finalized) return;
  ctx.finalized = true;
  Object.assign(ctx.call, patch, { durationMs: Date.now() - ctx.startedAt });
  if (!ctx.call.status) {
    ctx.call.status = res.statusCode || 0;
  }
  getAiCallStore().append(ctx.call);
}

export function getRecentAiCalls(limit = MAX_RECENT): AiCallLog[] {
  return getAiCallStore().recent(limit) as AiCallLog[];
}

// 失败请求的结构摘要：只记关键字段与规模，不序列化正文
//（请求体可达 32MB，全量 stringify 会拖垮失败路径且可能携带截图 base64）
export function requestExcerptOf(req: Request): string {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return '';
  }
  const b = body as Record<string, unknown>;
  const messages = Array.isArray(b.messages) ? b.messages : undefined;
  return JSON.stringify({
    model: b.model,
    stream: b.stream,
    messages: messages ? `${messages.length} messages` : undefined,
    system: typeof b.system === 'string' ? `${b.system.length} chars` : undefined,
    maxTokens: b.max_tokens ?? b.maxTokens,
  }).slice(0, EXCERPT_CHARS);
}

// anthropic SSE 流式 usage：message_start 携带 input_tokens，message_delta 携带 output_tokens
export function trackAnthropicSSEUsage(res: Response, line: string): void {
  if (!line.startsWith('data:')) return;
  try {
    const data = JSON.parse(line.slice(5).trim());
    if (data.type === 'message_start' && data.message?.usage) {
      patchCallLog(res, { usage: { inputTokens: data.message.usage.input_tokens } });
    } else if (data.type === 'message_delta' && data.usage) {
      patchCallLog(res, { usage: { outputTokens: data.usage.output_tokens } });
    }
  } catch {
    // 非 JSON 行（注释/心跳）忽略
  }
}

// openai SSE 流式 usage：stream_options.include_usage 时末 chunk 携带 usage
export function trackOpenAISSEUsage(res: Response, line: string): void {
  if (!line.startsWith('data:')) return;
  try {
    const data = JSON.parse(line.slice(5).trim());
    if (data.usage) {
      patchCallLog(res, {
        usage: { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens },
      });
    }
  } catch {
    // 非 JSON 行忽略
  }
}

// 上游响应正文摘要（已是字符串，直接截断）
export function responseExcerptOf(text: string): string {
  return text.slice(0, EXCERPT_CHARS);
}
