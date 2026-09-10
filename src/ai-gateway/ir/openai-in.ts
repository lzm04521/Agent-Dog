// src/ai-gateway/ir/openai-in.ts
// OpenAI chat/completions 请求 → IR（纯函数，无 IO）。设计文档 §4.1。
// 关键容错：连续 role:tool 消息合并为一条 IR user 消息——openai-out 重建时按
// "下一条 user 消息"一次性冲刷全部 pending 调用，逐条独立会丢多工具并发配对。
import { IRRequest, IRMessage, IRPart, IRTextPart, IRToolChoice } from './types.js';

export function openaiToIR(body: any): IRRequest {
  const system: IRTextPart[] = [];
  const messages: IRMessage[] = [];
  let pendingTools: { toolUseId: string; content: string }[] = []; // 连续 role:tool 缓冲

  for (const m of body.messages || []) {
    if (m.role === 'system' || m.role === 'developer') {
      const text = extractText(m.content);
      if (text) {
        system.push({ kind: 'text', text });
      }
      continue;
    }
    if (m.role === 'tool') {
      pendingTools.push({ toolUseId: m.tool_call_id || '', content: extractText(m.content) });
      continue;
    }
    if (m.role === 'function') {
      continue; // 旧版 function role 无 tool_call_id 无法配对，忽略（调用方可记 debug）
    }
    flushTools(messages, pendingTools);
    messages.push(m.role === 'assistant' ? parseAssistant(m) : parseUser(m));
  }
  flushTools(messages, pendingTools);

  return {
    system,
    messages,
    tools: (body.tools || [])
      .filter((t: any) => t.type === 'function' && t.function)
      .map((t: any) => ({ name: t.function.name, description: t.function.description || '', inputSchema: t.function.parameters ?? {} })),
    toolChoice: parseToolChoice(body.tool_choice),
    sampling: {
      maxTokens: body.max_completion_tokens ?? body.max_tokens ?? 4096,
      temperature: body.temperature,
      topP: body.top_p,
      stopSequences: normalizeStop(body.stop),
    },
    stream: body.stream === true,
  };
}

function flushTools(messages: IRMessage[], pending: { toolUseId: string; content: string }[]): void {
  if (pending.length === 0) {
    return;
  }
  messages.push({
    role: 'user',
    content: pending.splice(0).map(t => ({ kind: 'toolResult', toolUseId: t.toolUseId, content: t.content, isError: false })),
  });
}

function parseAssistant(m: any): IRMessage {
  const content: IRPart[] = [];
  if (typeof m.content === 'string') {
    if (m.content) {
      content.push({ kind: 'text', text: m.content });
    }
  } else if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (part.type === 'text' && part.text) {
        content.push({ kind: 'text', text: part.text });
      }
    }
  }
  for (const tc of m.tool_calls || []) {
    let args: any = {};
    try {
      args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      args = {};
    }
    content.push({ kind: 'toolUse', id: tc.id, name: tc.function?.name || '', args });
  }
  return { role: 'assistant', content };
}

function parseUser(m: any): IRMessage {
  const content: IRPart[] = [];
  if (typeof m.content === 'string') {
    content.push({ kind: 'text', text: m.content });
  } else if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (part.type === 'text') {
        content.push({ kind: 'text', text: part.text || '' });
      } else if (part.type === 'image_url') {
        const url: string = part.image_url?.url || '';
        const match = /^data:([^;]+);base64,(.+)$/.exec(url);
        if (match) {
          content.push({ kind: 'image', mime: match[1], data: match[2] });
        } else {
          content.push({ kind: 'text', text: '[unsupported image url]' });
        }
      }
    }
  }
  return { role: 'user', content };
}

// content 可为 string 或 {type:'text'} parts 数组
function extractText(content: any): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.filter((p: any) => p.type === 'text').map((p: any) => p.text || '').join('');
  }
  return '';
}

function parseToolChoice(tc: any): IRToolChoice | null {
  if (!tc) {
    return null;
  }
  if (tc === 'auto') return { mode: 'auto' };
  if (tc === 'none') return { mode: 'none' };
  if (tc === 'required') return { mode: 'required' };
  if (tc.type === 'function' && tc.function?.name) return { mode: 'specific', name: tc.function.name };
  return null;
}

// stop 可为 string 或 string[]，归一为数组；缺省 undefined
function normalizeStop(stop: any): string[] | undefined {
  if (typeof stop === 'string') {
    return [stop];
  }
  if (Array.isArray(stop) && stop.length) {
    return stop.filter((s: any) => typeof s === 'string');
  }
  return undefined;
}
