// IR → OpenAI chat/completions 请求体；OpenAI SSE/JSON 响应 → IR 事件流
import { IRRequest, IREvent, IRMessage } from './types.js';
import { openaiChatUrl } from '../upstream/model-lister.js';
import { AIProviderConfig } from '../../types/index.js';

// ===== 请求方向 =====

export function irToOpenAI(ir: IRRequest, provider: AIProviderConfig, model: string): {
  url: string; headers: Record<string, string>; body: any;
} {
  const messages: any[] = [];

  // system 并入首条 system 消息（分块合并为单字符串）
  if (ir.system.length > 0) {
    messages.push({ role: 'system', content: ir.system.map(p => p.text).join('\n\n') });
  }

  // openai 历史约束：assistant tool_calls 之后每个调用必须紧跟一条 role:tool 消息。
  // 状态机：assistant 轮吐出后，收集下一个 user 轮的 toolResult 按 id 配对输出；缺失补空 content。
  const pendingToolCalls: { id: string }[] = [];
  const toolResultById = new Map<string, { content: string }>();

  for (const msg of ir.messages) {
    // 上一轮 assistant 的 tool_calls 之后必须紧跟 tool 消息：
    // 无论下一条是什么，先冲刷 pending（缺失补空 content 容错，避免上游 400）
    if (msg.role !== 'assistant') {
      flushToolResults(messages, pendingToolCalls, toolResultById);
    }
    if (msg.role === 'assistant') {
      const toolCalls: any[] = [];
      let text = '';
      for (const part of msg.content) {
        if (part.kind === 'text') {
          text += part.text;
        } else if (part.kind === 'toolUse') {
          toolCalls.push({
            id: part.id,
            type: 'function',
            function: { name: part.name, arguments: JSON.stringify(part.args ?? {}) },
          });
          pendingToolCalls.push({ id: part.id });
        }
        // 图片块在 assistant 历史中无意义，丢弃
      }
      messages.push({
        role: 'assistant',
        content: text || (toolCalls.length ? null : ''),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else {
      // user 轮：先输出本轮 toolResult（若有），再输出普通内容
      const normalParts: any[] = [];
      for (const part of msg.content) {
        if (part.kind === 'toolResult') {
          toolResultById.set(part.toolUseId, { content: part.content });
        } else if (part.kind === 'text') {
          normalParts.push({ type: 'text', text: part.text });
        } else if (part.kind === 'image') {
          normalParts.push({ type: 'image_url', image_url: { url: `data:${part.mime};base64,${part.data}` } });
        }
      }
      if (toolResultById.size > 0) {
        flushToolResults(messages, pendingToolCalls, toolResultById);
      }
      if (normalParts.length > 0) {
        messages.push({ role: 'user', content: normalParts.length === 1 && normalParts[0].type === 'text' ? normalParts[0].text : normalParts });
      }
    }
  }
  // 末轮遗留未配对调用补空
  flushToolResults(messages, pendingToolCalls, toolResultById);

  const body: any = {
    model,
    messages,
    max_tokens: ir.sampling.maxTokens,
  };
  if (ir.sampling.temperature !== undefined) {
    body.temperature = ir.sampling.temperature;
  }
  if (ir.sampling.topP !== undefined) {
    body.top_p = ir.sampling.topP;
  }
  // top_k：openai 不支持，丢弃
  if (ir.sampling.stopSequences?.length) {
    body.stop = ir.sampling.stopSequences;
  }
  if (ir.tools.length > 0) {
    body.tools = ir.tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
  }
  if (ir.toolChoice) {
    switch (ir.toolChoice.mode) {
      case 'auto': body.tool_choice = 'auto'; break;
      case 'required': body.tool_choice = 'required'; break;
      case 'specific': body.tool_choice = { type: 'function', function: { name: ir.toolChoice.name } }; break;
      case 'none': body.tool_choice = 'none'; break;
    }
  }
  if (ir.stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  return {
    url: openaiChatUrl(provider.baseUrl),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}`, ...(provider.headers || {}) },
    body,
  };
}

// 输出 pendingToolCalls 对应的 role:tool 消息；缺失的补空 content 容错（避免上游 400）
function flushToolResults(messages: any[], pending: { id: string }[], results: Map<string, { content: string }>): void {
  for (const call of pending.splice(0)) {
    const result = results.get(call.id);
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: result ? result.content : '',
    });
    results.delete(call.id);
  }
}

// ===== 响应方向（流式） =====

// delta.tool_calls 按 index 有状态聚合：首帧 id/name → toolCallStart，args 增量 → toolCallDelta
export class OpenAIStreamState {
  private tools = new Map<number, { id: string; name: string; emitted: boolean }>();
  private finishEmitted = false;

  chunkToEvents(chunk: any): IREvent[] {
    const events: IREvent[] = [];
    const delta = chunk.choices?.[0]?.delta ?? {};
    const choice = chunk.choices?.[0];

    if (typeof delta.content === 'string' && delta.content) {
      events.push({ type: 'textDelta', text: delta.content });
    }
    // DeepSeek reasoner 类 reasoning_content：一期丢弃
    //（调用方可记录 debug 日志）

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const index = tc.index ?? 0;
        let entry = this.tools.get(index);
        if (!entry) {
          entry = { id: tc.id || `call_${index}`, name: tc.function?.name || '', emitted: false };
          this.tools.set(index, entry);
        }
        if (tc.id && tc.id !== entry.id) {
          entry.id = tc.id;
        }
        if (tc.function?.name && tc.function.name !== entry.name) {
          entry.name = tc.function.name;
        }
        if (!entry.emitted && entry.name) {
          entry.emitted = true;
          events.push({ type: 'toolCallStart', id: entry.id, name: entry.name });
        }
        if (tc.function?.arguments) {
          events.push({ type: 'toolCallDelta', argsDelta: tc.function.arguments });
        }
      }
    }

    if (choice?.finish_reason && !this.finishEmitted) {
      this.finishEmitted = true;
      // 每个 toolCallStart 对应一个 toolCallEnd（openai 增量到 finish 时参数已完整）
      let toolEnds = 0;
      for (const entry of this.tools.values()) {
        if (entry.emitted) {
          toolEnds++;
        }
      }
      events.push({ type: 'finish', reason: mapFinishReason(choice.finish_reason) });
      for (let i = 0; i < toolEnds; i++) {
        events.push({ type: 'toolCallEnd' });
      }
    }

    if (chunk.usage) {
      events.push({ type: 'usage', input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0 });
    }
    return events;
  }
}

export function mapFinishReason(reason: string): 'stop' | 'tool_calls' | 'length' {
  if (reason === 'tool_calls' || reason === 'function_call') {
    return 'tool_calls';
  }
  if (reason === 'length') {
    return 'length';
  }
  return 'stop';
}

// ===== 响应方向（非流式） =====

export function openaiFinalToIREvents(json: any): IREvent[] {
  const events: IREvent[] = [{ type: 'messageStart' }];
  const choice = json.choices?.[0];
  const message = choice?.message ?? {};

  if (typeof message.content === 'string' && message.content) {
    events.push({ type: 'textDelta', text: message.content });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      events.push({ type: 'toolCallStart', id: tc.id, name: tc.function?.name || '' });
      events.push({ type: 'toolCallDelta', argsDelta: tc.function?.arguments ?? '{}' });
      events.push({ type: 'toolCallEnd' });
    }
  }
  if (json.usage) {
    events.push({ type: 'usage', input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 });
  }
  if (choice?.finish_reason) {
    events.push({ type: 'finish', reason: mapFinishReason(choice.finish_reason) });
  }
  return events;
}

// SSE 行（不含 "data: " 前缀的 JSON 文本或 "[DONE]"）→ IR 事件
export function openaiSSELineToEvents(line: string, state: OpenAIStreamState): IREvent[] | null {
  if (!line.startsWith('data:')) {
    return null;
  }
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') {
    return [];
  }
  try {
    return state.chunkToEvents(JSON.parse(data));
  } catch {
    return null;
  }
}

export type { IRMessage };
