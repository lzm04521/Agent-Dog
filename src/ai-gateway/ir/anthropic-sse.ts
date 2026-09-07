// IR 事件流 → Anthropic SSE 出站（Claude Code 的解析契约）+ 非流式聚合
// 事件序列（设计文档 §6.3）：
// message_start → content_block_start(text, 0) → text_delta* → content_block_stop
// → [content_block_start(tool_use, index 递增) → input_json_delta* → content_block_stop]*
// → message_delta{stop_reason, usage} → message_stop；流期间 30s 一帧 ping 保活
import { Response } from 'express';
import { IREvent } from './types.js';

function sse(res: Response, event: string, data: any): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function mapStopReason(reason: 'stop' | 'tool_calls' | 'length'): string {
  if (reason === 'tool_calls') {
    return 'tool_use';
  }
  if (reason === 'length') {
    return 'max_tokens';
  }
  return 'end_turn';
}

export class AnthropicSSEWriter {
  private nextIndex = 0;
  private openBlock: 'text' | 'toolUse' | null = null;
  private started = false;
  private finished = false;
  private inputTokens = 0;
  private outputTokens = 0;
  private stopReason = 'end_turn';
  private pingTimer?: NodeJS.Timeout;

  constructor(private res: Response, private model: string) {}

  // 延迟提交后调用：写响应头 + message_start
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
    sse(this.res, 'message_start', {
      type: 'message_start',
      message: {
        id: `msg_${Date.now().toString(36)}`,
        type: 'message', role: 'assistant', model: this.model,
        content: [], stop_reason: null, stop_sequence: null,
        // 占位 usage：权威 input/output 在 message_delta 汇总（openai/gemini 流末才可得）
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    this.pingTimer = setInterval(() => {
      sse(this.res, 'ping', { type: 'ping' });
    }, 30_000);
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
        if (this.openBlock !== 'text') {
          this.closeBlock();
          this.openBlock = 'text';
          sse(this.res, 'content_block_start', {
            type: 'content_block_start', index: this.nextIndex++,
            content_block: { type: 'text', text: '' },
          });
        }
        sse(this.res, 'content_block_delta', {
          type: 'content_block_delta', index: this.nextIndex - 1,
          delta: { type: 'text_delta', text: ev.text },
        });
        break;
      case 'toolCallStart':
        this.ensureStart();
        this.closeBlock();
        this.openBlock = 'toolUse';
        sse(this.res, 'content_block_start', {
          type: 'content_block_start', index: this.nextIndex++,
          content_block: { type: 'tool_use', id: ev.id, name: ev.name, input: {} },
        });
        break;
      case 'toolCallDelta':
        sse(this.res, 'content_block_delta', {
          type: 'content_block_delta', index: this.nextIndex - 1,
          delta: { type: 'input_json_delta', partial_json: ev.argsDelta },
        });
        break;
      case 'toolCallEnd':
        this.closeBlock();
        break;
      case 'usage':
        this.inputTokens = ev.input;
        this.outputTokens = ev.output;
        break;
      case 'finish':
        this.stopReason = mapStopReason(ev.reason);
        break;
      case 'error':
        // 流内错误：若尚未提交响应头，由调用方兜底为 HTTP 错误；已提交则发 error 事件
        if (this.started) {
          sse(this.res, 'error', { type: 'error', error: { type: 'api_error', message: ev.message } });
        }
        break;
    }
  }

  private closeBlock(): void {
    if (this.openBlock) {
      sse(this.res, 'content_block_stop', { type: 'content_block_stop', index: this.nextIndex - 1 });
      this.openBlock = null;
    }
  }

  // 事件流结束：汇总 message_delta + message_stop
  finish(): void {
    if (this.finished) {
      return;
    }
    this.ensureStart();
    this.closeBlock();
    this.finished = true;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }
    sse(this.res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: this.stopReason, stop_sequence: null },
      usage: { input_tokens: this.inputTokens, output_tokens: this.outputTokens },
    });
    sse(this.res, 'message_stop', { type: 'message_stop' });
    this.res.end();
  }

  isCommitted(): boolean {
    return this.started;
  }
}

// 非流式：IR 事件序列聚合为单个 Anthropic Message JSON（Claude Code 也发非流式请求，如标题生成）
export function aggregateIR(events: IREvent[], model: string): any {
  const content: any[] = [];
  let text = '';
  let currentTool: { id: string; name: string; args: string } | null = null;
  let input = 0, output = 0;
  let stopReason: string | null = null;

  for (const ev of events) {
    switch (ev.type) {
      case 'textDelta':
        text += ev.text;
        break;
      case 'toolCallStart': {
        // 文本块在首个工具前落盘
        if (text) {
          content.push({ type: 'text', text });
          text = '';
        }
        currentTool = { id: ev.id, name: ev.name, args: '' };
        break;
      }
      case 'toolCallDelta':
        if (currentTool) {
          currentTool.args += ev.argsDelta;
        }
        break;
      case 'toolCallEnd':
        if (currentTool) {
          let parsed: any = {};
          try {
            parsed = currentTool.args ? JSON.parse(currentTool.args) : {};
          } catch {
            parsed = {}; // 截断的参数无法解析时给空对象，不作为成功静默——stop_reason 仍如实
          }
          content.push({ type: 'tool_use', id: currentTool.id, name: currentTool.name, input: parsed });
          currentTool = null;
        }
        break;
      case 'usage':
        input = ev.input;
        output = ev.output;
        break;
      case 'finish':
        stopReason = mapStopReason(ev.reason);
        break;
      case 'error':
        throw new Error(ev.message);
      default:
        break;
    }
  }
  if (text) {
    content.push({ type: 'text', text });
  }

  return {
    id: `msg_${Date.now().toString(36)}`,
    type: 'message', role: 'assistant', model,
    content, stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: input, output_tokens: output },
  };
}
