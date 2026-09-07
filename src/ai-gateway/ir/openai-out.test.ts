import { describe, it, expect } from 'vitest';
import { irToOpenAI, OpenAIStreamState, openaiSSELineToEvents, openaiFinalToIREvents } from './openai-out.js';
import { IRRequest } from './types.js';
import { AIProviderConfig } from '../../types/index.js';

const provider: AIProviderConfig = {
  id: '1', slug: 'deepseek', dialect: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'sk', enabled: true,
};

function baseIR(over: Partial<IRRequest> = {}): IRRequest {
  return {
    system: [], messages: [], tools: [], toolChoice: null,
    sampling: { maxTokens: 100 }, stream: false, ...over,
  };
}

describe('irToOpenAI（请求方向）', () => {
  it('system 分块合并为单字符串 system 消息', () => {
    const { body } = irToOpenAI(baseIR({ system: [{ kind: 'text', text: 'A' }, { kind: 'text', text: 'B' }] }), provider, 'm');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'A\n\nB' });
  });

  it('图片转 image_url data URL', () => {
    const { body } = irToOpenAI(baseIR({
      messages: [{ role: 'user', content: [{ kind: 'image', mime: 'image/png', data: 'AAA' }] }],
    }), provider, 'm');
    expect(body.messages[0].content[0].image_url.url).toBe('data:image/png;base64,AAA');
  });

  it('tool_use 转 tool_calls（arguments 为 JSON 字符串）、tool_result 紧跟配对', () => {
    const { body } = irToOpenAI(baseIR({
      messages: [
        { role: 'user', content: [{ kind: 'text', text: 'run ls' }] },
        { role: 'assistant', content: [{ kind: 'toolUse', id: 'c1', name: 'bash', args: { cmd: 'ls' } }] },
        { role: 'user', content: [{ kind: 'toolResult', toolUseId: 'c1', content: 'a.txt', isError: false }] },
      ],
    }), provider, 'm');
    const assistant = body.messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.tool_calls[0]).toEqual({
      id: 'c1', type: 'function', function: { name: 'bash', arguments: '{"cmd":"ls"}' },
    });
    const tool = body.messages[2];
    expect(tool).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'a.txt' });
  });

  it('缺失 tool_result 时补空 content 容错', () => {
    const { body } = irToOpenAI(baseIR({
      messages: [
        { role: 'assistant', content: [{ kind: 'toolUse', id: 'c1', name: 'bash', args: {} }] },
        { role: 'user', content: [{ kind: 'text', text: '继续' }] },
      ],
    }), provider, 'm');
    // assistant tool_calls 之后必须紧跟 tool 消息（空 content），user 文本在后
    expect(body.messages[1]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '' });
    expect(body.messages[2].role).toBe('user');
  });

  it('tools 包装 type:function、tool_choice 三态', () => {
    const tools = [{ name: 'bash', description: 'run', inputSchema: { type: 'object' } }];
    let r = irToOpenAI(baseIR({ tools, toolChoice: { mode: 'auto' } }), provider, 'm');
    expect(r.body.tools[0]).toEqual({ type: 'function', function: { name: 'bash', description: 'run', parameters: { type: 'object' } } });
    expect(r.body.tool_choice).toBe('auto');
    r = irToOpenAI(baseIR({ tools, toolChoice: { mode: 'required' } }), provider, 'm');
    expect(r.body.tool_choice).toBe('required');
    r = irToOpenAI(baseIR({ tools, toolChoice: { mode: 'specific', name: 'bash' } }), provider, 'm');
    expect(r.body.tool_choice).toEqual({ type: 'function', function: { name: 'bash' } });
  });

  it('采样参数：top_k 丢弃、stop 映射、stream 带 stream_options', () => {
    const ir = baseIR({
      sampling: { maxTokens: 7, temperature: 0.5, topP: 0.9, topK: 40, stopSequences: ['END'] },
    });
    const { body } = irToOpenAI(ir, provider, 'm');
    expect(body.max_tokens).toBe(7);
    expect(body.temperature).toBe(0.5);
    expect(body.top_p).toBe(0.9);
    expect(body).not.toHaveProperty('top_k');
    expect(body.stop).toEqual(['END']);
    expect(body).not.toHaveProperty('stream');

    const { body: sbody } = irToOpenAI({ ...ir, stream: true }, provider, 'm');
    expect(sbody.stream).toBe(true);
    expect(sbody.stream_options).toEqual({ include_usage: true });
  });

  it('URL 与认证头', () => {
    const r = irToOpenAI(baseIR(), provider, 'm');
    expect(r.url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(r.headers.authorization).toBe('Bearer sk');
    const p2 = { ...provider, baseUrl: 'https://x.com/v1/' };
    expect(irToOpenAI(baseIR(), p2, 'm').url).toBe('https://x.com/v1/chat/completions');
  });
});

describe('OpenAI SSE → IR 事件（流式）', () => {
  it('文本 delta、finish、usage 末帧', () => {
    const state = new OpenAIStreamState();
    const ev1 = openaiSSELineToEvents('data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}', state)!;
    expect(ev1).toEqual([{ type: 'textDelta', text: 'Hi' }]);
    const ev2 = openaiSSELineToEvents('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}', state)!;
    expect(ev2).toEqual([{ type: 'finish', reason: 'stop' }]);
    const ev3 = openaiSSELineToEvents('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}', state)!;
    expect(ev3).toEqual([{ type: 'usage', input: 10, output: 5 }]);
    expect(openaiSSELineToEvents('data: [DONE]', state)).toEqual([]);
  });

  it('多工具增量按 index 区分，首帧发 toolCallStart', () => {
    const state = new OpenAIStreamState();
    const ev1 = openaiSSELineToEvents('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"bash","arguments":"{\\"cm"}}]}}]}', state)!;
    const ev2 = openaiSSELineToEvents('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"d\\":\\"ls\\"}"}}]}}]}', state)!;
    const ev3 = openaiSSELineToEvents('data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"read","arguments":"{}"}}]}}]}', state)!;
    const ev4 = openaiSSELineToEvents('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}', state)!;
    expect(ev1).toEqual([
      { type: 'toolCallStart', id: 'c1', name: 'bash' },
      { type: 'toolCallDelta', argsDelta: '{"cm' },
    ]);
    expect(ev2).toEqual([{ type: 'toolCallDelta', argsDelta: 'd":"ls"}' }]);
    expect(ev3).toEqual([
      { type: 'toolCallStart', id: 'c2', name: 'read' },
      { type: 'toolCallDelta', argsDelta: '{}' },
    ]);
    // finish(tool_calls) + 两个 toolCallEnd
    expect(ev4).toEqual([
      { type: 'finish', reason: 'tool_calls' },
      { type: 'toolCallEnd' },
      { type: 'toolCallEnd' },
    ]);
  });

  it('reasoning_content 丢弃', () => {
    const state = new OpenAIStreamState();
    const ev = openaiSSELineToEvents('data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}', state)!;
    expect(ev).toEqual([]);
  });
});

describe('openaiFinalToIREvents（非流式）', () => {
  it('文本 + 工具 + usage + finish 一次性转换', () => {
    const events = openaiFinalToIREvents({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: '',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'bash', arguments: '{"cmd":"ls"}' } }],
        },
      }],
      usage: { prompt_tokens: 8, completion_tokens: 2 },
    });
    expect(events).toEqual([
      { type: 'messageStart' },
      { type: 'toolCallStart', id: 'c1', name: 'bash' },
      { type: 'toolCallDelta', argsDelta: '{"cmd":"ls"}' },
      { type: 'toolCallEnd' },
      { type: 'usage', input: 8, output: 2 },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });
});
