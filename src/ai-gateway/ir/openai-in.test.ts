// src/ai-gateway/ir/openai-in.test.ts
import { describe, it, expect } from 'vitest';
import { openaiToIR } from './openai-in.js';
import { irToOpenAI } from './openai-out.js';

describe('openaiToIR', () => {
  it('system/developer 消息按序收集为 IR.system', () => {
    const ir = openaiToIR({
      messages: [
        { role: 'system', content: '你是助手' },
        { role: 'developer', content: '补充规则' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(ir.system).toEqual([
      { kind: 'text', text: '你是助手' },
      { kind: 'text', text: '补充规则' },
    ]);
    expect(ir.messages).toEqual([{ role: 'user', content: [{ kind: 'text', text: 'hi' }] }]);
  });

  it('assistant tool_calls 解析为 toolUse（arguments 字符串转对象）', () => {
    const ir = openaiToIR({
      messages: [
        { role: 'user', content: '天气' },
        { role: 'assistant', content: null, tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"北京"}' } },
        ] },
        { role: 'tool', tool_call_id: 'call_1', content: '晴' },
      ],
    });
    expect(ir.messages[1]).toEqual({
      role: 'assistant',
      content: [{ kind: 'toolUse', id: 'call_1', name: 'get_weather', args: { city: '北京' } }],
    });
    expect(ir.messages[2]).toEqual({
      role: 'user',
      content: [{ kind: 'toolResult', toolUseId: 'call_1', content: '晴', isError: false }],
    });
  });

  it('关键容错：连续 role:tool 合并为单条 user 消息（round-trip 经 irToOpenAI 不丢配对）', () => {
    const body = {
      messages: [
        { role: 'user', content: '两个工具' },
        { role: 'assistant', content: null, tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'a', arguments: '{}' } },
          { id: 'call_2', type: 'function', function: { name: 'b', arguments: '{}' } },
        ] },
        { role: 'tool', tool_call_id: 'call_1', content: '结果1' },
        { role: 'tool', tool_call_id: 'call_2', content: '结果2' },
      ],
    };
    const ir = openaiToIR(body);
    // 两条 tool 消息合并为一条 user 消息
    expect(ir.messages.length).toBe(3);
    expect(ir.messages[2].content).toEqual([
      { kind: 'toolResult', toolUseId: 'call_1', content: '结果1', isError: false },
      { kind: 'toolResult', toolUseId: 'call_2', content: '结果2', isError: false },
    ]);
    // round-trip：重建后两条 role:tool 消息都有真实 content（回归防护）
    const rebuilt = irToOpenAI(ir, { id: 'x', slug: 'x', dialect: 'openai', baseUrl: 'https://x', apiKey: 'k', enabled: true }, 'm');
    const toolMessages = rebuilt.body.messages.filter((m: any) => m.role === 'tool');
    expect(toolMessages).toEqual([
      { role: 'tool', tool_call_id: 'call_1', content: '结果1' },
      { role: 'tool', tool_call_id: 'call_2', content: '结果2' },
    ]);
  });

  it('user parts 数组：text 与 data URI 图片', () => {
    const ir = openaiToIR({
      messages: [{ role: 'user', content: [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
      ] }],
    });
    expect(ir.messages[0].content).toEqual([
      { kind: 'text', text: '看图' },
      { kind: 'image', mime: 'image/png', data: 'QUJD' },
    ]);
  });

  it('http 图片 URL 与旧 function role 的容错', () => {
    const ir = openaiToIR({
      messages: [
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/img.png' } }] },
        { role: 'function', name: 'old', content: 'x' },
      ],
    });
    expect(ir.messages[0].content).toEqual([{ kind: 'text', text: '[unsupported image url]' }]);
    expect(ir.messages.length).toBe(1); // function role 忽略
  });

  it('tools / tool_choice / 采样参数', () => {
    const ir = openaiToIR({
      model: 'm', max_completion_tokens: 2048, temperature: 0.5, top_p: 0.9, stop: 'END', stream: true,
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } } }],
      tool_choice: { type: 'function', function: { name: 'f' } },
    });
    expect(ir.sampling).toEqual({ maxTokens: 2048, temperature: 0.5, topP: 0.9, stopSequences: ['END'] });
    expect(ir.tools).toEqual([{ name: 'f', description: 'd', inputSchema: { type: 'object' } }]);
    expect(ir.toolChoice).toEqual({ mode: 'specific', name: 'f' });
    expect(ir.stream).toBe(true);
  });

  it('max_tokens 缺省 4096；tool_choice 字符串形态', () => {
    const ir = openaiToIR({
      messages: [{ role: 'user', content: 'x' }], tool_choice: 'required',
    });
    expect(ir.sampling.maxTokens).toBe(4096);
    expect(ir.toolChoice).toEqual({ mode: 'required' });
  });
});
