import { describe, it, expect } from 'vitest';
import { resolveModel, ModelRouteError } from './model-router.js';
import { AIProviderConfig } from '../types/index.js';

const providers: AIProviderConfig[] = [
  { id: '1', slug: 'deepseek', dialect: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'k', enabled: true },
  { id: '2', slug: 'or', dialect: 'openai', baseUrl: 'https://x', apiKey: 'k', enabled: false },
];

describe('resolveModel', () => {
  it('解析 slug 与模型', () => {
    const r = resolveModel('deepseek:deepseek-chat', providers);
    expect(r.provider.id).toBe('1');
    expect(r.model).toBe('deepseek-chat');
  });

  it('模型名含斜杠原样透传', () => {
    expect(resolveModel('deepseek:openrouter/anthropic/claude-sonnet-4', providers).model)
      .toBe('openrouter/anthropic/claude-sonnet-4');
  });

  it('模型名含冒号只在第一个冒号分割', () => {
    expect(resolveModel('deepseek:a:b', providers).model).toBe('a:b');
  });

  it('无冒号抛错并提示格式', () => {
    expect(() => resolveModel('deepseek-chat', providers)).toThrow(ModelRouteError);
    expect(() => resolveModel('deepseek-chat', providers)).toThrowError(/slug:model/);
  });

  it('未知 slug 抛错并列出可用 slug', () => {
    try {
      resolveModel('foo:bar', providers);
      expect.unreachable('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ModelRouteError);
      expect((e as ModelRouteError).availableSlugs).toEqual(['deepseek']);
      expect((e as Error).message).toContain('foo');
      expect((e as Error).message).toContain('deepseek');
    }
  });

  it('禁用 slug 不参与寻址', () => {
    expect(() => resolveModel('or:bar', providers)).toThrow(ModelRouteError);
  });

  it('空串抛错', () => {
    expect(() => resolveModel('', providers)).toThrow(ModelRouteError);
  });
});
