// src/ai-gateway/openai-errors.test.ts
import { describe, it, expect } from 'vitest';
import { openaiError, mapUpstreamStatusToOpenAI } from './openai-errors.js';

function mockRes() {
  return {
    statusCode: 0, body: null as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
  } as any;
}

describe('openaiError', () => {
  it('基础错误体 {error:{message,type}}', () => {
    const res = mockRes();
    openaiError(res, 502, 'api_error', 'boom');
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: { message: 'boom', type: 'api_error' } });
  });

  it('带 code 时附加 code 字段', () => {
    const res = mockRes();
    openaiError(res, 400, 'invalid_request_error', 'bad', 'model_not_found');
    expect(res.body.error.code).toBe('model_not_found');
  });
});

describe('mapUpstreamStatusToOpenAI', () => {
  it.each([
    [401, 'invalid_request_error', 'invalid_api_key'],
    [403, 'invalid_request_error', 'invalid_api_key'],
    [404, 'invalid_request_error', 'model_not_found'],
    [429, 'rate_limit_error', undefined],
    [500, 'api_error', undefined],
    [529, 'api_error', undefined],
  ])('%i → %s', (status, type, code) => {
    const mapped = mapUpstreamStatusToOpenAI(status as number);
    expect(mapped.type).toBe(type);
    expect(mapped.code).toBe(code);
  });
});
