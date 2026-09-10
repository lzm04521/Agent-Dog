// src/ai-gateway/ir/openai-sse.test.ts
import { describe, it, expect } from 'vitest';
import { OpenAIChunkWriter, aggregateIROpenAI } from './openai-sse.js';
import { IREvent } from './types.js';

function mockRes() {
  const writes: string[] = [];
  return {
    writes,
    headersSent: false,
    headers: {} as Record<string, string>,
    writableEnded: false,
    writeHead(_s: number, h: Record<string, string>) { this.headersSent = true; Object.assign(this.headers, h); return this; },
    write(c: string) { writes.push(c); return true; },
    end() { this.writableEnded = true; return this; },
  } as any;
}

function run(events: IREvent[]) {
  const res = mockRes();
  const writer = new OpenAIChunkWriter(res, 'up-model');
  for (const ev of events) writer.write(ev);
  writer.finish();
  return { res, chunks: res.writes.map((w: string) => w.trim()).filter(Boolean) };
}

describe('OpenAIChunkWriter', () => {
  it('事件序列 → role 帧 + content 帧 + finish 帧 + usage 帧 + [DONE]', () => {
    const { res, chunks } = run([
      { type: 'messageStart' },
      { type: 'textDelta', text: '你' },
      { type: 'textDelta', text: '好' },
      { type: 'usage', input: 12, output: 3 },
      { type: 'finish', reason: 'stop' },
    ]);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(chunks[0]).toMatch(/^data: \{"id":"chatcmpl-/);
    expect(JSON.parse(chunks[0].slice(6)).choices[0].delta).toEqual({ role: 'assistant', content: '' });
    expect(JSON.parse(chunks[1].slice(6)).choices[0].delta).toEqual({ content: '你' });
    expect(JSON.parse(chunks[2].slice(6)).choices[0].delta).toEqual({ content: '好' });
    const finishChunk = JSON.parse(chunks[3].slice(6));
    expect(finishChunk.choices[0]).toEqual({ index: 0, delta: {}, finish_reason: 'stop' });
    const usageChunk = JSON.parse(chunks[4].slice(6));
    expect(usageChunk.choices).toEqual([]);
    expect(usageChunk.usage).toEqual({ prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 });
    expect(chunks[chunks.length - 1]).toBe('data: [DONE]');
    // 所有帧共享同一 id/model
    expect(JSON.parse(chunks[1].slice(6)).model).toBe('up-model');
    expect(JSON.parse(chunks[1].slice(6)).id).toBe(JSON.parse(chunks[0].slice(6)).id);
  });

  it('工具调用：tool_calls index 递增、arguments 增量、finish_reason=tool_calls', () => {
    const { chunks } = run([
      { type: 'messageStart' },
      { type: 'toolCallStart', id: 'c1', name: 'f1' },
      { type: 'toolCallDelta', argsDelta: '{"a":' },
      { type: 'toolCallDelta', argsDelta: '1}' },
      { type: 'toolCallEnd' },
      { type: 'toolCallStart', id: 'c2', name: 'f2' },
      { type: 'toolCallDelta', argsDelta: '{}' },
      { type: 'toolCallEnd' },
      { type: 'finish', reason: 'tool_calls' },
    ]);
    const toolFrames = chunks.map((c: string) => c.startsWith('data: {') ? JSON.parse(c.slice(6)) : null).filter(Boolean)
      .flatMap((j: any) => j.choices?.[0]?.delta?.tool_calls || []);
    expect(toolFrames).toEqual([
      { index: 0, id: 'c1', type: 'function', function: { name: 'f1', arguments: '' } },
      { index: 0, function: { arguments: '{"a":' } },
      { index: 0, function: { arguments: '1}' } },
      { index: 1, id: 'c2', type: 'function', function: { name: 'f2', arguments: '' } },
      { index: 1, function: { arguments: '{}' } },
    ]);
    const finishChunk = chunks.map((c: string) => c.startsWith('data: {') ? JSON.parse(c.slice(6)) : null).filter(Boolean)
      .find((j: any) => j.choices?.[0]?.finish_reason);
    expect(finishChunk.choices[0].finish_reason).toBe('tool_calls');
  });

  it('流内 error 事件 → data: {"error":...} 帧（OpenAI SSE 无标准 error 事件，取通行做法）', () => {
    const res = mockRes();
    const writer = new OpenAIChunkWriter(res, 'm');
    writer.write({ type: 'messageStart' });
    writer.write({ type: 'error', message: 'upstream failed' });
    writer.finish();
    expect(res.writes.join('')).toContain('"error"');
    expect(res.writes.join('')).toContain('upstream failed');
    expect(res.writes.join('')).toContain('data: [DONE]');
  });
});

describe('aggregateIROpenAI', () => {
  it('纯文本聚合', () => {
    const json = aggregateIROpenAI([
      { type: 'messageStart' },
      { type: 'textDelta', text: '你' },
      { type: 'textDelta', text: '好' },
      { type: 'usage', input: 5, output: 2 },
      { type: 'finish', reason: 'stop' },
    ], 'm');
    expect(json.object).toBe('chat.completion');
    expect(json.choices[0].message).toEqual({ role: 'assistant', content: '你好', refusal: null });
    expect(json.choices[0].finish_reason).toBe('stop');
    expect(json.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
  });

  it('纯工具调用：content 为 null、arguments 为 JSON 字符串', () => {
    const json = aggregateIROpenAI([
      { type: 'toolCallStart', id: 'c1', name: 'f' },
      { type: 'toolCallDelta', argsDelta: '{"a":1}' },
      { type: 'toolCallEnd' },
      { type: 'finish', reason: 'tool_calls' },
    ], 'm');
    expect(json.choices[0].message.content).toBeNull();
    expect(json.choices[0].message.tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } },
    ]);
  });

  it('截断的 arguments JSON 解析失败回退 {}（与 aggregateIR 同策略）', () => {
    const json = aggregateIROpenAI([
      { type: 'toolCallStart', id: 'c1', name: 'f' },
      { type: 'toolCallDelta', argsDelta: '{"a":' },
      { type: 'toolCallEnd' },
    ], 'm');
    expect(json.choices[0].message.tool_calls[0].function.arguments).toBe('{}');
  });
});
