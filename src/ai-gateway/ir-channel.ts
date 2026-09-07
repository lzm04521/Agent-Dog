// IR 转换通道执行器：anthropic-in → IR → 方言出口 → 上游 → IR 事件 → anthropic-sse 出站
// openai（Task 9）与 gemini（Task 10）共用；延迟提交/错误透传/abort 链/watchdog 语义见设计文档 §7。
import { Request, Response } from 'express';
import { AIProviderConfig } from '../types/index.js';
import { IREvent, IRRequest } from './ir/types.js';
import { anthropicToIR } from './ir/anthropic-in.js';
import { AnthropicSSEWriter, aggregateIR } from './ir/anthropic-sse.js';
import { sendUpstream } from './upstream/provider-client.js';
import { anthropicError, mapUpstreamStatus } from './anthropic-errors.js';
import { UPSTREAM_HEADER_TIMEOUT_MS, STREAM_WATCHDOG_MS } from './passthrough.js';

export interface DialectCodec {
  buildRequest(ir: IRRequest, provider: AIProviderConfig, model: string): {
    url: string; headers: Record<string, string>; body: any;
  };
  // SSE 行（含 data: 前缀）→ IR 事件；非 data 行返回 null
  parseSSELine(line: string, state: any): IREvent[] | null;
  createState(): any;
  // 非流式响应 JSON → IR 事件序列
  parseFinal(json: any): IREvent[];
}

export async function handleIRChannel(
  req: Request,
  res: Response,
  provider: AIProviderConfig,
  model: string,
  codec: DialectCodec
): Promise<void> {
  const ir = anthropicToIR(req.body);
  const { url, headers, body } = codec.buildRequest(ir, provider, model);

  const abort = new AbortController();
  res.on('close', () => abort.abort());

  let upstream;
  try {
    upstream = await sendUpstream({
      url,
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      timeoutMs: UPSTREAM_HEADER_TIMEOUT_MS,
      signal: abort.signal,
    });
  } catch (error) {
    if (abort.signal.aborted) {
      return;
    }
    const isTimeout = /timeout/i.test((error as Error).message);
    anthropicError(res, isTimeout ? 504 : 502, 'api_error', `upstream request failed: ${(error as Error).message}`);
    return;
  }

  // 上游错误：状态码透传，错误体转 Anthropic 格式、message 保留原文
  if (upstream.status !== 200) {
    if (res.writableEnded || abort.signal.aborted) {
      return;
    }
    const text = await upstream.text().catch(() => '');
    anthropicError(res, upstream.status, mapUpstreamStatus(upstream.status), text.slice(0, 2000) || `upstream ${upstream.status}`);
    return;
  }

  const state = codec.createState();

  if (!ir.stream) {
    // 非流式：聚合为单个 Anthropic Message JSON
    try {
      const text = await upstream.text();
      const events = codec.parseFinal(JSON.parse(text));
      const message = aggregateIR(events, model);
      res.status(200).json(message);
    } catch (error) {
      if (!res.writableEnded && !abort.signal.aborted) {
        anthropicError(res, 502, 'api_error', `failed to process upstream response: ${(error as Error).message}`);
      }
    }
    return;
  }

  // 流式：延迟提交——首个语义事件（textDelta/toolCallStart）前不写 message_start
  const writer = new AnthropicSSEWriter(res, model);
  const buffered: IREvent[] = [{ type: 'messageStart' }];
  let committed = false;

  const emit = (ev: IREvent): void => {
    if (!committed) {
      if (ev.type === 'textDelta' || ev.type === 'toolCallStart') {
        committed = true;
        for (const b of buffered) {
          writer.write(b);
        }
        writer.write(ev);
      } else if (ev.type === 'error') {
        // 首个语义事件前失败：可返回正确状态码的 JSON 错误体
        if (!res.headersSent) {
          anthropicError(res, 502, 'api_error', ev.message);
        }
      } else {
        buffered.push(ev);
      }
      return;
    }
    writer.write(ev);
  };

  let lastByteAt = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - lastByteAt > STREAM_WATCHDOG_MS) {
      clearInterval(watchdog);
      writer.write({ type: 'error', message: 'upstream stream stalled' });
      writer.finish();
      abort.abort();
    }
  }, 30_000);

  try {
    await upstream.stream(line => {
      lastByteAt = Date.now();
      const events = codec.parseSSELine(line, state);
      if (events) {
        for (const ev of events) {
          emit(ev);
        }
      }
    });
    if (!committed && !res.headersSent && !res.writableEnded) {
      // 无任何语义事件（如空回复）：正常提交空消息
      committed = true;
      for (const b of buffered) {
        writer.write(b);
      }
    }
    writer.finish();
  } catch (error) {
    clearInterval(watchdog);
    if (!res.headersSent && !res.writableEnded && !abort.signal.aborted) {
      anthropicError(res, 502, 'api_error', `upstream stream failed: ${(error as Error).message}`);
    } else {
      writer.write({ type: 'error', message: (error as Error).message });
      writer.finish();
    }
  }
}
