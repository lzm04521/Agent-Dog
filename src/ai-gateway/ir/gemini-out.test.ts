import { describe, it, expect } from 'vitest';
import { irToGemini, sanitizeSchema, GeminiStreamState, geminiSSELineToEvents, geminiFinalToIREvents } from './gemini-out.js';
import { IRRequest } from './types.js';
import { AIProviderConfig } from '../../types/index.js';

const provider: AIProviderConfig = {
  id: '1', slug: 'gemini', dialect: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'gk', enabled: true,
};

function baseIR(over: Partial<IRRequest> = {}): IRRequest {
  return { system: [], messages: [], tools: [], toolChoice: null, sampling: { maxTokens: 100 }, stream: false, ...over };
}

describe('irToGemini（请求方向）', () => {
  it('system → systemInstruction.parts、采样参数映射（topK 保留）', () => {
    const ir = baseIR({
      system: [{ kind: 'text', text: 'S' }],
      sampling: { maxTokens: 9, temperature: 0.7, topP: 0.8, topK: 40, stopSequences: ['X'] },
    });
    const { body, url, headers } = irToGemini(ir, provider, 'gemini-2.0-flash');
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'S' }] });
    expect(body.generationConfig).toEqual({ maxOutputTokens: 9, temperature: 0.7, topP: 0.8, topK: 40, stopSequences: ['X'] });
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');
    expect(headers['x-goog-api-key']).toBe('gk');
    // 流式 URL
    expect(irToGemini({ ...ir, stream: true }, provider, 'm').url).toContain(':streamGenerateContent?alt=sse');
  });

  it('图片 → inlineData（base64 无前缀）', () => {
    const { body } = irToGemini(baseIR({
      messages: [{ role: 'user', content: [{ kind: 'image', mime: 'image/png', data: 'AA==' }] }],
    }), provider, 'm');
    expect(body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/png', data: 'AA==' } });
  });

  it('tool_use → functionCall；tool_result 按函数名配对且 response 为 object', () => {
    const { body } = irToGemini(baseIR({
      messages: [
        { role: 'user', content: [{ kind: 'text', text: 'ls' }] },
        { role: 'assistant', content: [{ kind: 'toolUse', id: 'tu_9', name: 'bash', args: { cmd: 'ls' } }] },
        { role: 'user', content: [{ kind: 'toolResult', toolUseId: 'tu_9', content: 'a.txt', isError: false }] },
      ],
    }), provider, 'm');
    const modelTurn = body.contents.find((c: any) => c.role === 'model');
    expect(modelTurn.parts[0].functionCall).toEqual({ name: 'bash', args: { cmd: 'ls' } });
    const respTurn = body.contents.find((c: any) => c.parts?.[0]?.functionResponse);
    expect(respTurn.parts[0].functionResponse).toEqual({ name: 'bash', response: { content: 'a.txt' } });
    // functionResponse 紧随 model 轮
    expect(body.contents.indexOf(respTurn)).toBe(body.contents.indexOf(modelTurn) + 1);
  });

  it('isError 的 tool_result 包 {error}', () => {
    const { body } = irToGemini(baseIR({
      messages: [
        { role: 'assistant', content: [{ kind: 'toolUse', id: 't1', name: 'f', args: {} }] },
        { role: 'user', content: [{ kind: 'toolResult', toolUseId: 't1', content: 'boom', isError: true }] },
      ],
    }), provider, 'm');
    const respTurn = body.contents.find((c: any) => c.parts?.[0]?.functionResponse);
    expect(respTurn.parts[0].functionResponse.response).toEqual({ error: 'boom' });
  });

  it('tools 净化 JSON Schema（剥 $schema，保留 additionalProperties）', () => {
    const { body } = irToGemini(baseIR({
      tools: [{
        name: 'f', description: 'd',
        inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } },
      }],
    }), provider, 'm');
    const decl = body.tools[0].functionDeclarations[0];
    expect(decl.parameters).toEqual({ type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } });
  });

  it('tool_choice 四态映射', () => {
    let r = irToGemini(baseIR({ toolChoice: { mode: 'auto' } }), provider, 'm');
    expect(r.body.toolConfig.functionCallingConfig.mode).toBe('AUTO');
    r = irToGemini(baseIR({ toolChoice: { mode: 'required' } }), provider, 'm');
    expect(r.body.toolConfig.functionCallingConfig.mode).toBe('ANY');
    r = irToGemini(baseIR({ toolChoice: { mode: 'specific', name: 'f' } }), provider, 'm');
    expect(r.body.toolConfig.functionCallingConfig).toEqual({ mode: 'ANY', allowedFunctionNames: ['f'] });
    expect(irToGemini(baseIR(), provider, 'm').body).not.toHaveProperty('toolConfig');
  });
});

describe('Gemini SSE → IR 事件', () => {
  it('文本帧 + STOP finish + usageMetadata', () => {
    const state = new GeminiStreamState();
    const ev = geminiSSELineToEvents('data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":2}}', state)!;
    expect(ev).toEqual([
      { type: 'textDelta', text: 'Hi' },
      { type: 'finish', reason: 'stop' },
      { type: 'usage', input: 7, output: 2 },
    ]);
  });

  it('functionCall 全量 args 一帧三事件，缺 id 合成、STOP 修正为 tool_calls', () => {
    const state = new GeminiStreamState();
    const ev1 = geminiSSELineToEvents('data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"bash","args":{"cmd":"ls"}}}]}}]}', state)!;
    expect(ev1).toHaveLength(3);
    expect(ev1[0].type).toBe('toolCallStart');
    expect((ev1[0] as any).id).toMatch(/^call_/);
    expect(ev1[1]).toEqual({ type: 'toolCallDelta', argsDelta: '{"cmd":"ls"}' });
    expect(ev1[2]).toEqual({ type: 'toolCallEnd' });
    const ev2 = geminiSSELineToEvents('data: {"candidates":[{"content":{"parts":[{"text":"done"}]},"finishReason":"STOP"}]}', state)!;
    expect(ev2).toContainEqual({ type: 'finish', reason: 'tool_calls' });
  });

  it('thought part 丢弃、MAX_TOKENS → length', () => {
    const state = new GeminiStreamState();
    const ev = geminiSSELineToEvents('data: {"candidates":[{"content":{"parts":[{"text":"think","thought":true},{"text":"ans"}]},"finishReason":"MAX_TOKENS"}]}', state)!;
    expect(ev).toEqual([
      { type: 'textDelta', text: 'ans' },
      { type: 'finish', reason: 'length' },
    ]);
  });

  it('非流式 geminiFinalToIREvents', () => {
    const ev = geminiFinalToIREvents({
      candidates: [{ content: { parts: [{ functionCall: { name: 'f', args: { a: 1 } } }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 },
    });
    expect(ev[0]).toEqual({ type: 'messageStart' });
    expect(ev.find(e => e.type === 'finish')).toEqual({ type: 'finish', reason: 'tool_calls' });
    expect(ev.find(e => e.type === 'usage')).toEqual({ type: 'usage', input: 3, output: 1 });
  });
});

describe('sanitizeSchema', () => {
  it('递归剥离不支持键', () => {
    expect(sanitizeSchema({
      $schema: 'x', type: 'object',
      properties: { a: { type: 'string', $comment: 'c' }, b: { type: 'array', items: { $ref: '#/x', type: 'number' } } },
    })).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'number' } } },
    });
  });
});
