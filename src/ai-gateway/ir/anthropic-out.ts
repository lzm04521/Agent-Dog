// IR → Anthropic Messages 请求体；Anthropic SSE/JSON 响应 → IR 事件流（响应方向见下半部分）。
// 仅服务 openai 入口 → anthropic 上游；anthropic 入口→anthropic 上游走字节级直通（passthrough.ts），
// cache_control/thinking 等原生字段零损耗的路径不经过本模块。
import { IRRequest, IREvent, IRMessage } from './types.js';
import { anthropicMessagesUrl } from '../upstream/model-lister.js';
import { AIProviderConfig } from '../../types/index.js';

// ===== 请求方向 =====

export function irToAnthropic(ir: IRRequest, provider: AIProviderConfig, model: string): {
  url: string; headers: Record<string, string>; body: any;
} {
  const body: any = {
    model,
    max_tokens: ir.sampling.maxTokens,
    messages: ir.messages.map(irMessageToAnthropic).filter((m: { content: any[] }) => m.content.length > 0),
  };
  const system = ir.system.filter(p => p.text).map(p => ({
    type: 'text', text: p.text,
    ...(p.cache ? { cache_control: { type: 'ephemeral' } } : {}),
  }));
  if (system.length > 0) {
    body.system = system;
  }
  // tool_choice none：Anthropic 无该类型，等价表达为不发送 tools
  if (ir.tools.length > 0 && ir.toolChoice?.mode !== 'none') {
    body.tools = ir.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    if (ir.toolChoice) {
      if (ir.toolChoice.mode === 'auto') body.tool_choice = { type: 'auto' };
      else if (ir.toolChoice.mode === 'required') body.tool_choice = { type: 'any' };
      else if (ir.toolChoice.mode === 'specific') body.tool_choice = { type: 'tool', name: ir.toolChoice.name };
    }
  }
  if (ir.sampling.temperature !== undefined) body.temperature = ir.sampling.temperature;
  if (ir.sampling.topP !== undefined) body.top_p = ir.sampling.topP;
  if (ir.sampling.topK !== undefined) body.top_k = ir.sampling.topK;
  if (ir.sampling.stopSequences?.length) body.stop_sequences = ir.sampling.stopSequences;
  if (ir.stream) body.stream = true;

  return {
    url: anthropicMessagesUrl(provider.baseUrl),
    headers: {
      'content-type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      ...(provider.headers || {}),
    },
    body,
  };
}

function irMessageToAnthropic(m: IRMessage): { role: 'user' | 'assistant'; content: any[] } {
  const content: any[] = [];
  for (const part of m.content) {
    switch (part.kind) {
      case 'text':
        if (part.text) content.push({ type: 'text', text: part.text }); // 空文本块 Anthropic 拒绝，跳过
        break;
      case 'image':
        content.push({ type: 'image', source: { type: 'base64', media_type: part.mime, data: part.data } });
        break;
      case 'toolUse':
        content.push({ type: 'tool_use', id: part.id, name: part.name, input: part.args ?? {} });
        break;
      case 'toolResult':
        content.push({
          type: 'tool_result', tool_use_id: part.toolUseId,
          content: [{ type: 'text', text: part.content }],
          ...(part.isError ? { is_error: true } : {}),
        });
        break;
    }
  }
  return { role: m.role, content };
}

// ===== 响应方向（流式） =====
// Anthropic SSE 事件按 content_block index 记录块类型；事件类型在 data JSON 的 type 字段，
// 不依赖 "event:" 行（provider-client 逐行回调两种行都会到，非 data 行忽略）。

export class AnthropicStreamState {
  private blockTypes = new Map<number, string>();
  private finished = false;

  eventToEvents(data: any): IREvent[] {
    const events: IREvent[] = [];
    switch (data.type) {
      case 'message_start':
        events.push({ type: 'messageStart' });
        break; // message_start 内 usage 为估算占位，权威值取 message_delta
      case 'content_block_start':
        this.blockTypes.set(data.index, data.content_block?.type || '');
        if (data.content_block?.type === 'tool_use') {
          events.push({ type: 'toolCallStart', id: data.content_block.id, name: data.content_block.name });
        }
        break;
      case 'content_block_delta': {
        const delta = data.delta || {};
        if (delta.type === 'text_delta' && delta.text) {
          events.push({ type: 'textDelta', text: delta.text });
        } else if (delta.type === 'input_json_delta' && delta.partial_json) {
          events.push({ type: 'toolCallDelta', argsDelta: delta.partial_json });
        }
        // thinking_delta 丢弃（设计 P6）
        break;
      }
      case 'content_block_stop':
        if (this.blockTypes.get(data.index) === 'tool_use') {
          events.push({ type: 'toolCallEnd' });
        }
        this.blockTypes.delete(data.index);
        break;
      case 'message_delta': {
        if (!this.finished) {
          this.finished = true;
          events.push({ type: 'finish', reason: mapAnthropicStopReason(data.delta?.stop_reason) });
        }
        const usage = data.usage || {};
        if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) {
          events.push({ type: 'usage', input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 });
        }
        break;
      }
      case 'error':
        events.push({ type: 'error', message: data.error?.message || 'upstream error' });
        break;
      // ping / message_stop：无 IR 事件
    }
    return events;
  }
}

function mapAnthropicStopReason(reason: string | undefined): 'stop' | 'tool_calls' | 'length' {
  if (reason === 'tool_use') return 'tool_calls';
  if (reason === 'max_tokens') return 'length';
  return 'stop'; // end_turn / 其他
}

// SSE 行（含 "data:" 前缀）→ IR 事件；非 data 行返回 null
export function anthropicSSELineToEvents(line: string, state: AnthropicStreamState): IREvent[] | null {
  if (!line.startsWith('data:')) {
    return null;
  }
  const data = line.slice(5).trim();
  if (!data) {
    return [];
  }
  try {
    return state.eventToEvents(JSON.parse(data));
  } catch {
    return null;
  }
}

// ===== 响应方向（非流式） =====

export function anthropicFinalToIREvents(json: any): IREvent[] {
  const events: IREvent[] = [{ type: 'messageStart' }];
  for (const block of json.content || []) {
    if (block.type === 'text' && block.text) {
      events.push({ type: 'textDelta', text: block.text });
    } else if (block.type === 'tool_use') {
      events.push({ type: 'toolCallStart', id: block.id, name: block.name });
      events.push({ type: 'toolCallDelta', argsDelta: JSON.stringify(block.input ?? {}) });
      events.push({ type: 'toolCallEnd' });
    }
  }
  const usage = json.usage || {};
  if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) {
    events.push({ type: 'usage', input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 });
  }
  if (json.stop_reason) {
    events.push({ type: 'finish', reason: mapAnthropicStopReason(json.stop_reason) });
  }
  return events;
}
