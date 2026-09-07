// IR（中间表示）消息模型：Anthropic 入站解析为目标，openai/gemini 出口从它构造；
// 上游响应归一为 IREvent 事件流后统一转 Anthropic SSE 出站。

// ===== 请求向（消息模型） =====

export interface IRTextPart {
  kind: 'text';
  text: string;
  cache?: boolean; // anthropic cache_control 标记（anthropic 出口还原，其余方言丢弃）
}

export interface IRImagePart {
  kind: 'image';
  mime: string;   // 如 image/png
  data: string;   // base64（无 data: 前缀）
}

export interface IRToolUsePart {
  kind: 'toolUse';
  id: string;     // tool_use id
  name: string;
  args: any;      // 已解析的 JSON 对象
}

export interface IRToolResultPart {
  kind: 'toolResult';
  toolUseId: string;
  content: string;      // 内容块提取的 text 拼接
  isError: boolean;
}

export type IRPart = IRTextPart | IRImagePart | IRToolUsePart | IRToolResultPart;

export interface IRMessage {
  role: 'user' | 'assistant';
  content: IRPart[];
}

export interface IRTool {
  name: string;
  description: string;
  inputSchema: any; // JSON Schema
}

export interface IRToolChoice {
  mode: 'auto' | 'none' | 'required' | 'specific';
  name?: string;
}

export interface IRSampling {
  maxTokens: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
}

export interface IRRequest {
  system: IRTextPart[];
  messages: IRMessage[];
  tools: IRTool[];
  toolChoice: IRToolChoice | null;
  sampling: IRSampling;
  stream: boolean;
}

// ===== 响应向（统一事件流） =====

export type IREvent =
  | { type: 'messageStart' }
  | { type: 'textDelta'; text: string }
  | { type: 'toolCallStart'; id: string; name: string }
  | { type: 'toolCallDelta'; argsDelta: string }
  | { type: 'toolCallEnd' }
  | { type: 'usage'; input: number; output: number }
  | { type: 'finish'; reason: 'stop' | 'tool_calls' | 'length' }
  | { type: 'error'; message: string };
