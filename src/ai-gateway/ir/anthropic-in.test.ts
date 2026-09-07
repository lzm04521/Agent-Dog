import { describe, it, expect } from 'vitest';
import { anthropicToIR } from './anthropic-in.js';

describe('anthropicToIR', () => {
  it('string content 与 blocks 混合解析', () => {
    const ir = anthropicToIR({
      messages: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: [{ type: 'text', text: '在' }] },
        { role: 'user', content: [{ type: 'text', text: '继续' }] },
      ],
      max_tokens: 100,
    });
    expect(ir.messages).toHaveLength(3);
    expect(ir.messages[0].content).toEqual([{ kind: 'text', text: '你好' }]);
    expect(ir.messages[1].role).toBe('assistant');
    expect(ir.sampling.maxTokens).toBe(100);
  });

  it('tool_use 与 tool_result 按 id 配对保留', () => {
    const ir = anthropicToIR({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'bash', input: { cmd: 'ls' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: 'a.txt' }], is_error: false }],
        },
      ],
      max_tokens: 10,
    });
    expect(ir.messages[0].content[0]).toEqual({ kind: 'toolUse', id: 'tu_1', name: 'bash', args: { cmd: 'ls' } });
    expect(ir.messages[1].content[0]).toEqual({
      kind: 'toolResult', toolUseId: 'tu_1', content: 'a.txt', isError: false,
    });
  });

  it('system 分块解析并保留 cache 标记', () => {
    const ir = anthropicToIR({
      system: [
        { type: 'text', text: 'A', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'B' },
      ],
      messages: [],
      max_tokens: 10,
    });
    expect(ir.system).toEqual([
      { kind: 'text', text: 'A', cache: true },
      { kind: 'text', text: 'B' },
    ]);
  });

  it('system 字符串形态', () => {
    expect(anthropicToIR({ system: 'sys', messages: [], max_tokens: 1 }).system)
      .toEqual([{ kind: 'text', text: 'sys' }]);
  });

  it('图片 base64 块解析', () => {
    const ir = anthropicToIR({
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] }],
      max_tokens: 1,
    });
    expect(ir.messages[0].content[0]).toEqual({ kind: 'image', mime: 'image/png', data: 'AAAA' });
  });

  it('thinking 历史块丢弃', () => {
    const ir = anthropicToIR({
      messages: [{ role: 'assistant', content: [
        { type: 'thinking', thinking: '...', signature: 'x' },
        { type: 'text', text: '答案' },
      ] }],
      max_tokens: 1,
    });
    expect(ir.messages[0].content).toEqual([{ kind: 'text', text: '答案' }]);
  });

  it('tools 与 tool_choice 四态映射', () => {
    const tools = [{ name: 'bash', description: 'run', input_schema: { type: 'object' } }];
    expect(anthropicToIR({ messages: [], tools, tool_choice: { type: 'auto' }, max_tokens: 1 }).toolChoice)
      .toEqual({ mode: 'auto' });
    expect(anthropicToIR({ messages: [], tools, tool_choice: { type: 'any' }, max_tokens: 1 }).toolChoice)
      .toEqual({ mode: 'required' });
    expect(anthropicToIR({ messages: [], tools, tool_choice: { type: 'tool', name: 'bash' }, max_tokens: 1 }).toolChoice)
      .toEqual({ mode: 'specific', name: 'bash' });
    expect(anthropicToIR({ messages: [], tools, max_tokens: 1 }).toolChoice).toBeNull();
  });

  it('sampling 全参', () => {
    const ir = anthropicToIR({
      messages: [], max_tokens: 7, temperature: 0.5, top_p: 0.9, top_k: 40, stop_sequences: ['\n\n'],
    });
    expect(ir.sampling).toEqual({ maxTokens: 7, temperature: 0.5, topP: 0.9, topK: 40, stopSequences: ['\n\n'] });
  });

  it('stream 标志', () => {
    expect(anthropicToIR({ messages: [], max_tokens: 1, stream: true }).stream).toBe(true);
    expect(anthropicToIR({ messages: [], max_tokens: 1 }).stream).toBe(false);
  });
});
