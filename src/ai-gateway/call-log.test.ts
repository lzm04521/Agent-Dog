// getAiCallStore 惰性初始化，beforeEach 设 AGENTDOG_LOG_DIR + reset 后用例内首次调用即生效
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Response } from 'express';
import {
  beginCallLog,
  patchCallLog,
  getRecentAiCalls,
  getAiCallStore,
  resetAiCallStoreForTests,
  requestExcerptOf,
  trackAnthropicSSEUsage,
  trackOpenAISSEUsage,
  responseExcerptOf,
} from './call-log.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agentdog-calllog-'));
  process.env.AGENTDOG_LOG_DIR = dir;
  resetAiCallStoreForTests(); // 单例跟随新目录重新初始化，缓冲不跨用例累积
});

afterEach(async () => {
  // 等 fire-and-forget 落盘完成再删临时目录，避免用例尾部的 write 撞上目录清理
  await getAiCallStore().ready().catch(() => {});
  await new Promise((r) => setTimeout(r, 30));
  delete process.env.AGENTDOG_LOG_DIR;
  await rm(dir, { recursive: true, force: true });
});

// 最小 Response mock：express 的 res.locals / 事件注册 / statusCode
function mockRes(statusCode = 200, headersSent = true) {
  const listeners = new Map<string, (() => void)[]>();
  const res = {
    locals: {},
    headersSent,
    statusCode,
    on(event: string, cb: () => void) {
      listeners.set(event, [...(listeners.get(event) || []), cb]);
      return res;
    },
    emit(event: string) {
      (listeners.get(event) || []).forEach((cb) => cb());
    },
  } as unknown as Response & { emit: (e: string) => void };
  return res;
}

function mockReq(body: unknown) {
  return { body } as any;
}

describe('call-log 埋点协议', () => {
  it('begin + finish → finalize 落一条流水，status/durationMs 就位', async () => {
    const res = mockRes(200);
    beginCallLog(res, { ingress: 'anthropic', path: '/anthropic/v1/messages', model: 'zhipu:glm-4' });
    patchCallLog(res, { providerName: 'zhipu', upstreamModel: 'glm-4' });

    res.emit('finish');

    const calls = getRecentAiCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      ingress: 'anthropic',
      path: '/anthropic/v1/messages',
      model: 'zhipu:glm-4',
      providerName: 'zhipu',
      upstreamModel: 'glm-4',
      status: 200,
    });
    expect(calls[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(calls[0].id).toBeTruthy();
  });

  it('finish 与 close 连续触发只落一条（finalized 防重）', () => {
    const res = mockRes(200);
    beginCallLog(res, { ingress: 'openai', path: '/openai/v1/chat/completions', model: '' });

    res.emit('finish');
    res.emit('close');

    expect(getRecentAiCalls()).toHaveLength(1);
  });

  it('断连（close 且未发响应头）记 status 499', () => {
    const res = mockRes(200, false);
    beginCallLog(res, { ingress: 'anthropic', path: '/v1/messages', model: 'x' });

    res.emit('close');

    expect(getRecentAiCalls()[0].status).toBe(499);
  });

  it('流式 usage 分帧 patch 被合并而非覆盖', () => {
    const res = mockRes(200);
    beginCallLog(res, { ingress: 'anthropic', path: '/v1/messages', model: 'x' });

    patchCallLog(res, { usage: { inputTokens: 12 } });
    patchCallLog(res, { usage: { outputTokens: 34 } });

    res.emit('finish');
    expect(getRecentAiCalls()[0].usage).toEqual({ inputTokens: 12, outputTokens: 34 });
  });
});

describe('SSE usage 解析', () => {
  it('anthropic：message_start 取 input、message_delta 取 output', () => {
    const res = mockRes();
    beginCallLog(res, { ingress: 'anthropic', path: '/v1/messages', model: 'x' });

    trackAnthropicSSEUsage(res, 'event: message_start');
    trackAnthropicSSEUsage(res, `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 7 } } })}`);
    trackAnthropicSSEUsage(res, `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 9 } })}`);
    trackAnthropicSSEUsage(res, 'data: not-json');

    res.emit('finish');
    expect(getRecentAiCalls()[0].usage).toEqual({ inputTokens: 7, outputTokens: 9 });
  });

  it('openai：末 chunk usage 直接取 prompt/completion', () => {
    const res = mockRes();
    beginCallLog(res, { ingress: 'openai', path: '/openai/v1/chat/completions', model: 'x' });

    trackOpenAISSEUsage(res, `data: ${JSON.stringify({ choices: [] })}`);
    trackOpenAISSEUsage(res, `data: ${JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 6 } })}`);

    res.emit('finish');
    expect(getRecentAiCalls()[0].usage).toEqual({ inputTokens: 5, outputTokens: 6 });
  });
});

describe('摘要边界', () => {
  it('requestExcerpt 只记结构摘要，不含 messages 正文', () => {
    const req = mockReq({
      model: 'zhipu:glm-4',
      stream: true,
      messages: [{ role: 'user', content: 'x'.repeat(100000) }],
      max_tokens: 1024,
    });

    const excerpt = requestExcerptOf(req);
    expect(excerpt).toContain('"model":"zhipu:glm-4"');
    expect(excerpt).toContain('1 messages');
    expect(excerpt.length).toBeLessThan(300);
    expect(excerpt).not.toContain('xxxx');
  });

  it('requestExcerpt 空请求体返回空串', () => {
    expect(requestExcerptOf(mockReq(undefined))).toBe('');
  });

  it('responseExcerpt 截断到 500 字符', () => {
    expect(responseExcerptOf('y'.repeat(2000)).length).toBe(500);
  });
});

describe('store 落盘', () => {
  it('finalize 后 ai-calls.jsonl 出现对应 JSON 行', async () => {
    const res = mockRes(200);
    beginCallLog(res, { ingress: 'anthropic', path: '/v1/messages', model: 'm' });
    res.emit('finish');

    await getAiCallStore().ready();
    await new Promise((r) => setTimeout(r, 50));

    const { readFile } = await import('fs/promises');
    const text = await readFile(join(dir, 'ai-calls.jsonl'), 'utf8');
    const line = JSON.parse(text.trim().split('\n')[0]);
    expect(line.model).toBe('m');
    expect(line.path).toBe('/v1/messages');
  });
});
