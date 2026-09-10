// src/ai-gateway/ir/openai-sse.ts
// IR 事件流 → OpenAI chat/completions 出站（对称 ir/anthropic-sse.ts）：
// 流式 chunk 写出器（延迟提交语义与 AnthropicSSEWriter 一致，由 ir-channel 的 emit 驱动）+ 非流式聚合。
// 无 ping 保活（OpenAI SSE 无此约定，设计 P6 已知限制）；usage 帧为 include_usage 约定的空 choices 帧。
import { Response } from 'express';
import { IREvent } from './types.js';

export class OpenAIChunkWriter {
  private started = false;
  private finished = false;
  private toolIndex = -1; // IR 事件流工具调用严格串行，逐个递增
  private promptTokens = 0;
  private completionTokens = 0;
  private usageEmitted = false;
  private stopReason: 'stop' | 'tool_calls' | 'length' = 'stop';
  private readonly id = `chatcmpl-${Date.now().toString(36)}`;
  private readonly created = Math.floor(Date.now() / 1000);

  constructor(private res: Response, private model: string) {}

  private chunk(delta: any, finishReason: string | null = null, choices: any[] | null = null): void {
    const payload: any = {
      id: this.id, object: 'chat.completion.chunk', created: this.created, model: this.model,
      choices: choices ?? [{ index: 0, delta, finish_reason: finishReason }],
    };
    this.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  // 延迟提交后调用：写响应头 + role 帧
  private ensureStart(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    this.chunk({ role: 'assistant', content: '' });
  }

  write(ev: IREvent): void {
    if (this.finished) {
      return;
    }
    switch (ev.type) {
      case 'messageStart':
        this.ensureStart();
        break;
      case 'textDelta':
        this.ensureStart();
        this.chunk({ content: ev.text });
        break;
      case 'toolCallStart':
        this.ensureStart();
        this.toolIndex++;
        this.chunk({ tool_calls: [{ index: this.toolIndex, id: ev.id, type: 'function', function: { name: ev.name, arguments: '' } }] });
        break;
      case 'toolCallDelta':
        this.chunk({ tool_calls: [{ index: this.toolIndex, function: { arguments: ev.argsDelta } }] });
        break;
      case 'toolCallEnd':
        break; // OpenAI chunk 按 index 配对，无显式关闭帧
      case 'usage':
        this.promptTokens = ev.input;
        this.completionTokens = ev.output;
        this.usageEmitted = true;
        break;
      case 'finish':
        this.stopReason = ev.reason; // IR reason 与 OpenAI finish_reason 同名（stop/tool_calls/length）
        break;
      case 'error':
        if (this.started) {
          // 流内错误：尚未提交响应头由 ir-channel 兜底为 HTTP 错误
          this.res.write(`data: ${JSON.stringify({ error: { message: ev.message, type: 'api_error' } })}\n\n`);
        }
        break;
    }
  }

  // 事件流结束：finish 帧 + 可选 usage 帧 + [DONE]
  finish(): void {
    if (this.finished) {
      return;
    }
    this.ensureStart();
    this.finished = true;
    this.chunk({}, this.stopReason);
    if (this.usageEmitted) {
      // usage 帧不复用 chunk()（缺 usage 字段）：include_usage 约定的空 choices 帧单独写出
      this.res.write(`data: ${JSON.stringify({
        id: this.id, object: 'chat.completion.chunk', created: this.created, model: this.model,
        choices: [],
        usage: { prompt_tokens: this.promptTokens, completion_tokens: this.completionTokens, total_tokens: this.promptTokens + this.completionTokens },
      })}\n\n`);
    }
    this.res.write('data: [DONE]\n\n');
    this.res.end();
  }
}

// 非流式：IR 事件序列聚合为单个 chat.completion JSON
export function aggregateIROpenAI(events: IREvent[], model: string): any {
  let text: string | null = null;
  let currentTool: { id: string; name: string; args: string } | null = null;
  const toolCalls: any[] = [];
  let input = 0, output = 0;
  let finishReason: string | null = null;

  for (const ev of events) {
    switch (ev.type) {
      case 'textDelta':
        text = (text ?? '') + ev.text;
        break;
      case 'toolCallStart':
        currentTool = { id: ev.id, name: ev.name, args: '' };
        break;
      case 'toolCallDelta':
        if (currentTool) {
          currentTool.args += ev.argsDelta;
        }
        break;
      case 'toolCallEnd':
        if (currentTool) {
          toolCalls.push(toOpenAIToolCall(currentTool));
          currentTool = null;
        }
        break;
      case 'usage':
        input = ev.input;
        output = ev.output;
        break;
      case 'finish':
        finishReason = ev.reason;
        break;
      case 'error':
        throw new Error(ev.message);
      default:
        break;
    }
  }
  if (currentTool) { // 未闭合容错
    toolCalls.push(toOpenAIToolCall(currentTool));
  }

  const message: any = { role: 'assistant', content: text, refusal: null };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }
  return {
    id: `chatcmpl-${Date.now().toString(36)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason ?? 'stop' }],
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
  };
}

function toOpenAIToolCall(tool: { id: string; name: string; args: string }): any {
  return { id: tool.id, type: 'function', function: { name: tool.name, arguments: normalizeArgs(tool.args) } };
}

// 截断/非法 JSON 回退 '{}'（与 aggregateIR 同策略）
function normalizeArgs(args: string): string {
  if (!args) {
    return '{}';
  }
  try {
    JSON.parse(args);
    return args;
  } catch {
    return '{}';
  }
}
