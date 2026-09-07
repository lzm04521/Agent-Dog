// IR → Gemini generateContent 请求体；Gemini SSE/JSON 响应 → IR 事件流
// 约束（设计文档 §6.2）：
// - functionResponse.response 必须为 object（text→{content}，isError→{error}）
// - tool_result 的函数名需从历史 assistant 消息按 tool_use_id 回查
// - tools 的 JSON Schema 需净化（剥离 $schema 等 Gemini 不支持的 draft 元数据键；additionalProperties 保留）
import { randomUUID } from 'crypto';
import { IRRequest, IREvent } from './types.js';
import { geminiGenerateUrl } from '../upstream/model-lister.js';
import { AIProviderConfig } from '../../types/index.js';

// ===== 请求方向 =====

export function irToGemini(ir: IRRequest, provider: AIProviderConfig, model: string): {
  url: string; headers: Record<string, string>; body: any;
} {
  // tool_use_id → 函数名回查表（从历史 assistant 消息）
  const nameByToolUseId = new Map<string, string>();
  for (const msg of ir.messages) {
    if (msg.role === 'assistant') {
      for (const part of msg.content) {
        if (part.kind === 'toolUse') {
          nameByToolUseId.set(part.id, part.name);
        }
      }
    }
  }

  const contents: any[] = [];
  for (const msg of ir.messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts: any[] = [];
    const functionResponses: any[] = [];

    for (const part of msg.content) {
      if (part.kind === 'text') {
        parts.push({ text: part.text });
      } else if (part.kind === 'image') {
        parts.push({ inlineData: { mimeType: part.mime, data: part.data } }); // base64 无前缀
      } else if (part.kind === 'toolUse') {
        parts.push({ functionCall: { name: part.name, args: part.args ?? {} } });
      } else if (part.kind === 'toolResult') {
        const fname = nameByToolUseId.get(part.toolUseId) || 'unknown';
        functionResponses.push({
          functionResponse: {
            name: fname,
            // response 必须为 object
            response: part.isError ? { error: part.content } : { content: part.content },
          },
        });
      }
    }
    // tool_result 提为独立 user 轮的 functionResponse parts（紧随 model functionCall 之后）
    if (functionResponses.length > 0) {
      if (parts.length > 0) {
        contents.push({ role, parts });
      }
      contents.push({ role: 'user', parts: functionResponses });
    } else {
      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }
  }

  const body: any = { contents };
  if (ir.system.length > 0) {
    body.systemInstruction = { parts: ir.system.map(p => ({ text: p.text })) };
  }
  if (ir.tools.length > 0) {
    body.tools = [{
      functionDeclarations: ir.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: sanitizeSchema(t.inputSchema),
      })),
    }];
  }
  if (ir.toolChoice) {
    const toolConfig: any = { functionCallingConfig: {} };
    switch (ir.toolChoice.mode) {
      case 'auto': toolConfig.functionCallingConfig.mode = 'AUTO'; break;
      case 'required': toolConfig.functionCallingConfig.mode = 'ANY'; break;
      case 'none': toolConfig.functionCallingConfig.mode = 'NONE'; break;
      case 'specific':
        toolConfig.functionCallingConfig.mode = 'ANY';
        toolConfig.functionCallingConfig.allowedFunctionNames = [ir.toolChoice.name!];
        break;
    }
    body.toolConfig = toolConfig;
  }

  const gen: any = { maxOutputTokens: ir.sampling.maxTokens };
  if (ir.sampling.temperature !== undefined) {
    gen.temperature = ir.sampling.temperature;
  }
  if (ir.sampling.topP !== undefined) {
    gen.topP = ir.sampling.topP;
  }
  if (ir.sampling.topK !== undefined) {
    gen.topK = ir.sampling.topK; // gemini 支持，可保留
  }
  if (ir.sampling.stopSequences?.length) {
    gen.stopSequences = ir.sampling.stopSequences;
  }
  body.generationConfig = gen;

  return {
    url: geminiGenerateUrl(provider.baseUrl, model, ir.stream),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': provider.apiKey, ...(provider.headers || {}) },
    body,
  };
}

// 剥离 Gemini 不支持的 JSON Schema draft 元数据键（$schema 等）；additionalProperties 官方已支持、保留
const GEMINI_UNSUPPORTED_KEYS = new Set(['$schema', '$id', '$defs', '$ref', '$comment', 'definitions']);
export function sanitizeSchema(schema: any): any {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchema);
  }
  if (schema && typeof schema === 'object') {
    const out: any = {};
    for (const [key, value] of Object.entries(schema)) {
      if (GEMINI_UNSUPPORTED_KEYS.has(key)) {
        continue;
      }
      out[key] = sanitizeSchema(value);
    }
    return out;
  }
  return schema;
}

// ===== 响应方向 =====

// gemini SSE（alt=sse）每帧为完整 GenerateContentResponse JSON；
// functionCall 为非增量全量 args；id 可选——上游给了就透传，缺省合成 call_<uuid>
// 并记 name↔id 映射（Claude Code 回传 tool_result 按 tool_use_id 回查函数名）
export class GeminiStreamState {
  private nameById = new Map<string, string>();
  private finishEmitted = false;

  lookupName(id: string): string | undefined {
    return this.nameById.get(id);
  }

  frameToEvents(frame: any): IREvent[] {
    const events: IREvent[] = [];
    const candidate = frame.candidates?.[0];

    for (const part of candidate?.content?.parts || []) {
      if (typeof part.text === 'string' && part.text && part.thought !== true) {
        events.push({ type: 'textDelta', text: part.text });
      }
      if (part.functionCall && part.functionCall.name) {
        const id = part.functionCall.id || `call_${randomUUID()}`;
        this.nameById.set(id, part.functionCall.name);
        events.push({ type: 'toolCallStart', id, name: part.functionCall.name });
        events.push({ type: 'toolCallDelta', argsDelta: JSON.stringify(part.functionCall.args ?? {}) });
        events.push({ type: 'toolCallEnd' });
      }
      // thought: true 的 part 丢弃
    }

    if (candidate?.finishReason && !this.finishEmitted) {
      this.finishEmitted = true;
      events.push({ type: 'finish', reason: mapGeminiFinish(candidate.finishReason) });
    }

    const usage = frame.usageMetadata;
    if (usage) {
      events.push({
        type: 'usage',
        input: usage.promptTokenCount ?? 0,
        output: usage.candidatesTokenCount ?? 0,
      });
    }
    return events;
  }
}

export function mapGeminiFinish(reason: string): 'stop' | 'tool_calls' | 'length' {
  // gemini 不显式区分工具调用结束：functionCall 出现时由调用方把 stop 覆盖为 tool_calls（见 frameToEvents 调用方）
  if (reason === 'MAX_TOKENS') {
    return 'length';
  }
  return 'stop';
}

// 非流式响应 → IR 事件
export function geminiFinalToIREvents(json: any): IREvent[] {
  const state = new GeminiStreamState();
  const events = state.frameToEvents(json);
  // 非流式含 functionCall 时 finish 映射为 tool_calls
  if (events.some(e => e.type === 'toolCallStart')) {
    const finish = events.find(e => e.type === 'finish') as { type: 'finish'; reason: any } | undefined;
    if (finish && finish.reason === 'stop') {
      finish.reason = 'tool_calls';
    }
  }
  return [{ type: 'messageStart' }, ...events];
}

// SSE 行 → IR 事件（data: 前缀，JSON 全帧）
export function geminiSSELineToEvents(line: string, state: GeminiStreamState): IREvent[] | null {
  if (!line.startsWith('data:')) {
    return null;
  }
  const data = line.slice(5).trim();
  if (!data) {
    return [];
  }
  try {
    const events = state.frameToEvents(JSON.parse(data));
    // 流式 functionCall 后接 STOP：覆盖为 tool_calls
    if (events.some(e => e.type === 'toolCallStart')) {
      // 记录本帧有工具调用，供后续 STOP 帧修正
      (state as any).sawToolCall = true;
    }
    const finish = events.find(e => e.type === 'finish') as { type: 'finish'; reason: any } | undefined;
    if (finish && finish.reason === 'stop' && (state as any).sawToolCall) {
      finish.reason = 'tool_calls';
    }
    return events;
  } catch {
    return null;
  }
}

export { randomUUID };
