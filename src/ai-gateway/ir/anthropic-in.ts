// Anthropic Messages 请求 → IR（纯函数，无 IO）
import { IRRequest, IRMessage, IRPart, IRTool, IRToolChoice } from './types.js';

export function anthropicToIR(body: any): IRRequest {
  return {
    system: parseSystem(body.system),
    messages: (body.messages || []).map(parseMessage),
    tools: (body.tools || []).map(parseTool),
    toolChoice: parseToolChoice(body.tool_choice),
    sampling: {
      maxTokens: body.max_tokens ?? 4096,
      temperature: body.temperature,
      topP: body.top_p,
      topK: body.top_k,
      stopSequences: body.stop_sequences,
    },
    stream: body.stream === true,
  };
}

// system 可为字符串或分块数组（含 cache_control）
function parseSystem(system: any): IRTextPartT[] {
  if (!system) {
    return [];
  }
  if (typeof system === 'string') {
    return system ? [{ kind: 'text', text: system }] : [];
  }
  if (Array.isArray(system)) {
    return system
      .filter((b: any) => b.type === 'text')
      .map((b: any) => ({
        kind: 'text' as const,
        text: b.text || '',
        ...(b.cache_control ? { cache: true } : {}),
      }));
  }
  return [];
}
type IRTextPartT = IRRequest['system'][number];

function parseMessage(m: any): IRMessage {
  const content: IRPart[] = [];
  // content 可为字符串（仅 user 侧合法，但容错处理两种）
  if (typeof m.content === 'string') {
    content.push({ kind: 'text', text: m.content });
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content };
  }

  for (const block of m.content || []) {
    switch (block.type) {
      case 'text':
        content.push({
          kind: 'text',
          text: block.text || '',
          ...(block.cache_control ? { cache: true } : {}),
        });
        break;
      case 'image':
        content.push(parseImage(block));
        break;
      case 'tool_use':
        content.push({ kind: 'toolUse', id: block.id, name: block.name, args: block.input ?? {} });
        break;
      case 'tool_result':
        content.push({
          kind: 'toolResult',
          toolUseId: block.tool_use_id,
          content: extractText(block.content),
          isError: block.is_error === true,
        });
        break;
      case 'thinking':
        // 历史思维链：IR 通道丢弃（debug 由调用方记录）
        break;
      default:
        break;
    }
  }
  return { role: m.role === 'assistant' ? 'assistant' : 'user', content };
}

// image 块：source.source_type === 'base64' 取 media_type/data；URL 图标不支持，跳过
function parseImage(block: any): IRPart {
  const source = block.source;
  if (!source || source.type !== 'base64') {
    return { kind: 'text', text: '[unsupported image source]' };
  }
  return { kind: 'image', mime: source.media_type, data: source.data };
}

// tool_result.content 可为字符串或内容块数组，提取 text 拼接
function extractText(content: any): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((b: any) => {
        if (b.type === 'text') {
          return b.text || '';
        }
        if (b.type === 'image') {
          return '[image]';
        }
        return '';
      })
      .join('');
  }
  return '';
}

function parseTool(t: any): IRTool {
  return { name: t.name, description: t.description || '', inputSchema: t.input_schema ?? {} };
}

function parseToolChoice(tc: any): IRToolChoice | null {
  if (!tc) {
    return null;
  }
  if (tc.type === 'auto') {
    return { mode: 'auto' };
  }
  if (tc.type === 'any') {
    return { mode: 'required' };
  }
  if (tc.type === 'tool') {
    return { mode: 'specific', name: tc.name };
  }
  return null; // type: 'none' 等极少见值
}
