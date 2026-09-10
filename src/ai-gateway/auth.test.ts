import { describe, it, expect } from 'vitest';
import { createGatewayAuth } from './auth.js';
import { mapUpstreamStatus } from './anthropic-errors.js';

function mockRes() {
  return {
    statusCode: 0,
    body: null as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
  } as any;
}

describe('createGatewayAuth', () => {
  it('x-api-key 通过', () => {
    const auth = createGatewayAuth('sk-test');
    let next = 0;
    auth({ headers: { 'x-api-key': 'sk-test' }, path: '/v1/messages' } as any, mockRes(), () => next++);
    expect(next).toBe(1);
  });

  it('Authorization: Bearer 通过', () => {
    const auth = createGatewayAuth('sk-test');
    let next = 0;
    auth({ headers: { authorization: 'Bearer sk-test' }, path: '/v1/messages' } as any, mockRes(), () => next++);
    expect(next).toBe(1);
  });

  it('错误 key 返回 401 且 Anthropic 格式错误体', () => {
    const auth = createGatewayAuth('sk-test');
    let next = 0;
    const res = mockRes();
    auth({ headers: { 'x-api-key': 'bad' }, path: '/v1/messages' } as any, res, () => next++);
    expect(next).toBe(0);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    });
  });

  it('错误 key 且 /openai 路径返回 401 OpenAI 格式错误体', () => {
    const auth = createGatewayAuth('sk-test');
    const res = mockRes();
    auth({ headers: { 'x-api-key': 'bad' }, path: '/openai/v1/models' } as any, res, () => {});
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toEqual({ message: 'invalid x-api-key or bearer token', type: 'invalid_request_error', code: 'invalid_api_key' });
  });

  it('无认证头拒绝', () => {
    const auth = createGatewayAuth('sk-test');
    const res = mockRes();
    auth({ headers: {}, path: '/v1/messages' } as any, res, () => { throw new Error('should not call next'); });
    expect(res.statusCode).toBe(401);
  });
});

describe('mapUpstreamStatus', () => {
  it.each([
    [401, 'authentication_error'],
    [403, 'authentication_error'],
    [404, 'not_found_error'],
    [429, 'rate_limit_error'],
    [500, 'api_error'],
    [529, 'api_error'],
    [400, 'api_error'],
  ])('%i → %s', (status, expected) => {
    expect(mapUpstreamStatus(status)).toBe(expected);
  });
});
