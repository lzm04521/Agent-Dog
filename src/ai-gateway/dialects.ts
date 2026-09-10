// 方言 codec 注册表：IR 通道执行器按 dialect 取 codec
import { DialectCodec } from './ir-channel.js';
import { irToOpenAI, OpenAIStreamState, openaiSSELineToEvents, openaiFinalToIREvents } from './ir/openai-out.js';
import { irToGemini, GeminiStreamState, geminiSSELineToEvents, geminiFinalToIREvents } from './ir/gemini-out.js';
import { irToAnthropic, AnthropicStreamState, anthropicSSELineToEvents, anthropicFinalToIREvents } from './ir/anthropic-out.js';

export const openaiCodec: DialectCodec = {
  buildRequest: irToOpenAI,
  parseSSELine: openaiSSELineToEvents,
  createState: () => new OpenAIStreamState(),
  parseFinal: openaiFinalToIREvents,
};

export const geminiCodec: DialectCodec = {
  buildRequest: irToGemini,
  parseSSELine: geminiSSELineToEvents,
  createState: () => new GeminiStreamState(),
  parseFinal: geminiFinalToIREvents,
};

export const anthropicCodec: DialectCodec = {
  buildRequest: irToAnthropic,
  parseSSELine: anthropicSSELineToEvents,
  createState: () => new AnthropicStreamState(),
  parseFinal: anthropicFinalToIREvents,
};
