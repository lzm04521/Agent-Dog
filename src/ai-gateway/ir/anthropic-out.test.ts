// src/ai-gateway/ir/anthropic-out.test.ts
import { describe, it, expect } from 'vitest';
import { irToAnthropic } from './anthropic-out.js';
import { IRRequest } from './types.js';

const provider = { id: '1', slug: 'official', dialect: 'anthropic' as const, baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant', enabled: true };

function baseIR(overrides: Partial<IRRequest> = {}): IRRequest {
  return {
    system: [], messages: [{ role: 'user', content: [{ kind: 'text', text: 'hi' }] }],
    tools: [], toolChoice: null,
    sampling: { maxTokens: 100, temperature: 0.5, topP: undefined, topK: undefined, stopSequences: undefined },
    stream: false,
    ...overrides,
  };
}

describe('irToAnthropic', () => {
  it('基础请求：max_tokens 必填、认证头、URL', () => {
    const { url, headers, body } = irToAnthropic(baseIR(), provider, 'claude-sonnet-4');
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers['x-api-key']).toBe('sk-ant');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(body.model).toBe('claude-sonnet-4');
    expect(body.max_tokens).toBe(100);
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
  });

  it('system cache 标记还原为 cache_control', () => {
    const { body } = irToAnthropic(baseIR({
      system: [
        { kind: 'text', text: '规则A' },
        { kind: 'text', text: '规则B', cache: true },
      ],
    }), provider, 'm');
    expect(body.system).toEqual([
      { type: 'text', text: '规则A' },
      { type: 'text', text: '规则B', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('内容块映射：image / tool_use / tool_result(is_error)', () => {
    const { body } = irToAnthropic(baseIR({
      messages: [
        { role: 'user', content: [
          { kind: 'image', mime: 'image/png', data: 'QUJD' },
          { kind: 'toolResult', toolUseId: 't1', content: '失败', isError: true },
        ] },
        { role: 'assistant', content: [{ kind: 'toolUse', id: 't1', name: 'f', args: { a: 1 } }] },
      ],
    }), provider, 'm');
    expect(body.messages[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
      { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '失败' }], is_error: true },
    ]);
    expect(body.messages[1].content).toEqual([{ type: 'tool_use', id: 't1', name: 'f', input: { a: 1 } }]);
  });

  it('tools + tool_choice 映射：required→any、specific→tool', () => {
    const { body } = irToAnthropic(baseIR({
      tools: [{ name: 'f', description: 'd', inputSchema: { type: 'object' } }],
      toolChoice: { mode: 'required' },
    }), provider, 'm');
    expect(body.tools).toEqual([{ name: 'f', description: 'd', input_schema: { type: 'object' } }]);
    expect(body.tool_choice).toEqual({ type: 'any' });

    const { body: b2 } = irToAnthropic(baseIR({
      tools: [{ name: 'f', description: '', inputSchema: {} }],
      toolChoice: { mode: 'specific', name: 'f' },
    }), provider, 'm');
    expect(b2.tool_choice).toEqual({ type: 'tool', name: 'f' });
  });

  it('tool_choice none：不发送 tools 也不发送 tool_choice', () => {
    const { body } = irToAnthropic(baseIR({
      tools: [{ name: 'f', description: '', inputSchema: {} }],
      toolChoice: { mode: 'none' },
    }), provider, 'm');
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it('空文本块跳过；空 content 消息被过滤', () => {
    const { body } = irToAnthropic(baseIR({
      messages: [
        { role: 'user', content: [{ kind: 'text', text: '' }] },
        { role: 'user', content: [{ kind: 'text', text: 'ok' }] },
      ],
    }), provider, 'm');
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'ok' }] }]);
  });

  it('stream 与采样参数', () => {
    const { body } = irToAnthropic(baseIR({
      sampling: { maxTokens: 10, temperature: undefined, topP: 0.9, topK: 3, stopSequences: ['END'] },
      stream: true,
    }), provider, 'm');
    expect(body.stream).toBe(true);
    expect(body.top_p).toBe(0.9);
    expect(body.top_k).toBe(3);
    expect(body.stop_sequences).toEqual(['END']);
    expect(body.temperature).toBeUndefined();
  });
});

import { AnthropicStreamState, anthropicSSELineToEvents, anthropicFinalToIREvents } from './anthropic-out.js';
import { IREvent } from './types.js';

function feedSSE(lines: string[]): IREvent[] {
  const state = new AnthropicStreamState();
  const events: IREvent[] = [];
  for (const line of lines) {
    const out = anthropicSSELineToEvents(line, state);
    if (out) events.push(...out);
  }
  return events;
}

describe('anthropic SSE → IR 事件', () => {
  it('文本 + 工具调用 + usage + stop_reason 完整序列', () => {
    const events = feedSSE([
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}',
      'data: {"type":"content_block_stop","index":0}',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"f","input":{}}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":"}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"1}"}}',
      'data: {"type":"content_block_stop","index":1}',
      'data: {"type":"ping"}',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"input_tokens":9,"output_tokens":8}}',
      'data: {"type":"message_stop"}',
    ]);
    expect(events).toEqual([
      { type: 'messageStart' },
      { type: 'textDelta', text: '好' },
      { type: 'toolCallStart', id: 't1', name: 'f' },
      { type: 'toolCallDelta', argsDelta: '{"a":' },
      { type: 'toolCallDelta', argsDelta: '1}' },
      { type: 'toolCallEnd' },
      { type: 'finish', reason: 'tool_calls' },
      { type: 'usage', input: 9, output: 8 },
    ]);
  });

  it('thinking_delta 丢弃；text 块 content_block_stop 不产 toolCallEnd', () => {
    const events = feedSSE([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"内部思考"}}',
      'data: {"type":"content_block_stop","index":0}',
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"input_tokens":1,"output_tokens":2}}',
    ]);
    expect(events).toEqual([
      { type: 'finish', reason: 'length' },
      { type: 'usage', input: 1, output: 2 },
    ]);
  });

  it('流内 error 事件 → error IREvent', () => {
    const events = feedSSE(['data: {"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}']);
    expect(events).toEqual([{ type: 'error', message: 'overloaded' }]);
  });

  it('非 data 行返回 null', () => {
    expect(anthropicSSELineToEvents('event: ping', new AnthropicStreamState())).toBeNull();
  });
});

describe('anthropicFinalToIREvents（非流式）', () => {
  it('Message JSON → IR 事件序列', () => {
    const events = anthropicFinalToIREvents({
      content: [
        { type: 'text', text: '你好' },
        { type: 'tool_use', id: 't1', name: 'f', input: { a: 1 } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 7, output_tokens: 3 },
    });
    expect(events).toEqual([
      { type: 'messageStart' },
      { type: 'textDelta', text: '你好' },
      { type: 'toolCallStart', id: 't1', name: 'f' },
      { type: 'toolCallDelta', argsDelta: '{"a":1}' },
      { type: 'toolCallEnd' },
      { type: 'usage', input: 7, output: 3 },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });
});
