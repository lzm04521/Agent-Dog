import { describe, it, expect } from 'vitest';
import { AnthropicSSEWriter, aggregateIR } from './anthropic-sse.js';
import { IREvent } from './types.js';

function collectWriter() {
  const frames: { event: string; data: any }[] = [];
  const res: any = {
    headersSent: true,
    writeHead: () => {},
    write: (chunk: string) => {
      const eventMatch = chunk.match(/^event: (.+)\ndata: (.+)\n\n/s);
      if (eventMatch) {
        frames.push({ event: eventMatch[1], data: JSON.parse(eventMatch[2]) });
      }
    },
    end: () => {},
  };
  return { res, frames };
}

describe('AnthropicSSEWriter', () => {
  it('完整事件序列：message_start → blocks → message_delta → message_stop，index 递增', () => {
    const { res, frames } = collectWriter();
    const writer = new AnthropicSSEWriter(res, 'm');
    const events: IREvent[] = [
      { type: 'messageStart' },
      { type: 'textDelta', text: 'Hi' },
      { type: 'toolCallStart', id: 'c1', name: 'bash' },
      { type: 'toolCallDelta', argsDelta: '{"cmd"' },
      { type: 'toolCallEnd' },
      { type: 'usage', input: 10, output: 5 },
      { type: 'finish', reason: 'tool_calls' },
    ];
    events.forEach(e => writer.write(e));
    writer.finish();

    expect(frames.map(f => f.event)).toEqual([
      'message_start',
      'content_block_start', 'content_block_delta', 'content_block_stop',
      'content_block_start', 'content_block_delta', 'content_block_stop',
      'message_delta', 'message_stop',
    ]);
    // text block index 0
    expect(frames[1].data.index).toBe(0);
    expect(frames[1].data.content_block.type).toBe('text');
    expect(frames[2].data.delta).toEqual({ type: 'text_delta', text: 'Hi' });
    // tool_use block index 1，带 id/name
    expect(frames[4].data.index).toBe(1);
    expect(frames[4].data.content_block).toEqual({ type: 'tool_use', id: 'c1', name: 'bash', input: {} });
    expect(frames[5].data.delta).toEqual({ type: 'input_json_delta', partial_json: '{"cmd"' });
    // message_delta 汇总 usage + stop_reason
    expect(frames[7].data.delta.stop_reason).toBe('tool_use');
    expect(frames[7].data.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
    expect(frames[0].data.message.usage).toEqual({ input_tokens: 0, output_tokens: 0 }); // 占位
  });

  it('stop_reason 映射：stop→end_turn、length→max_tokens', () => {
    for (const [reason, expected] of [['stop', 'end_turn'], ['length', 'max_tokens']] as const) {
      const { res, frames } = collectWriter();
      const writer = new AnthropicSSEWriter(res, 'm');
      writer.write({ type: 'messageStart' });
      writer.write({ type: 'textDelta', text: 'x' });
      writer.write({ type: 'finish', reason });
      writer.finish();
      expect(frames.at(-2)!.data.delta.stop_reason).toBe(expected);
    }
  });

  it('连续 textDelta 复用同一 block，不重复 start', () => {
    const { res, frames } = collectWriter();
    const writer = new AnthropicSSEWriter(res, 'm');
    writer.write({ type: 'messageStart' });
    writer.write({ type: 'textDelta', text: 'a' });
    writer.write({ type: 'textDelta', text: 'b' });
    writer.finish();
    expect(frames.filter(f => f.event === 'content_block_start')).toHaveLength(1);
  });
});

describe('aggregateIR（非流式聚合）', () => {
  it('文本 + 工具调用聚合为 Message JSON', () => {
    const message = aggregateIR([
      { type: 'messageStart' },
      { type: 'textDelta', text: '查一下' },
      { type: 'toolCallStart', id: 'c1', name: 'bash' },
      { type: 'toolCallDelta', argsDelta: '{"cmd":' },
      { type: 'toolCallDelta', argsDelta: '"ls"}' },
      { type: 'toolCallEnd' },
      { type: 'usage', input: 3, output: 4 },
      { type: 'finish', reason: 'tool_calls' },
    ], 'm');
    expect(message.content).toEqual([
      { type: 'text', text: '查一下' },
      { type: 'tool_use', id: 'c1', name: 'bash', input: { cmd: 'ls' } },
    ]);
    expect(message.stop_reason).toBe('tool_use');
    expect(message.usage).toEqual({ input_tokens: 3, output_tokens: 4 });
  });

  it('纯文本回复', () => {
    const message = aggregateIR([
      { type: 'textDelta', text: '好的' },
      { type: 'finish', reason: 'stop' },
    ], 'm');
    expect(message.content).toEqual([{ type: 'text', text: '好的' }]);
    expect(message.stop_reason).toBe('end_turn');
  });
});
