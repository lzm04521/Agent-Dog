// src/ai-gateway/models-list.test.ts
import { describe, it, expect } from 'vitest';
import { collectModels, buildAnthropicModelsList, buildOpenAIModelsList } from './models-list.js';
import { AIProviderConfig } from '../types/index.js';

const providers: AIProviderConfig[] = [
  { id: '1', slug: 'deepseek', dialect: 'openai', baseUrl: 'https://x', apiKey: 'k', enabled: true,
    models: ['deepseek-chat', 'deepseek-reasoner'], disabledModels: ['deepseek-reasoner'] },
  { id: '2', slug: 'official', dialect: 'anthropic', baseUrl: 'https://x', apiKey: 'k', enabled: true,
    models: ['claude-sonnet-4'] },
  { id: '3', slug: 'off', dialect: 'openai', baseUrl: 'https://x', apiKey: 'k', enabled: false,
    models: ['should-not-appear'] },
  { id: '4', slug: 'empty', dialect: 'gemini', baseUrl: 'https://x', apiKey: 'k', enabled: true },
];

describe('collectModels', () => {
  it('enabled 供应商、过滤 disabledModels、按 slug 字典序、组内原序', () => {
    expect(collectModels(providers)).toEqual([
      { slug: 'deepseek', modelId: 'deepseek-chat' },
      { slug: 'official', modelId: 'claude-sonnet-4' },
    ]);
  });
});

describe('buildAnthropicModelsList', () => {
  it('Anthropic 官方格式：data/first_id/has_more/last_id', () => {
    const json = buildAnthropicModelsList(providers);
    expect(json.data).toEqual([
      { type: 'model', id: 'deepseek:deepseek-chat', display_name: 'deepseek-chat', created_at: '1970-01-01T00:00:00Z' },
      { type: 'model', id: 'official:claude-sonnet-4', display_name: 'claude-sonnet-4', created_at: '1970-01-01T00:00:00Z' },
    ]);
    expect(json.first_id).toBe('deepseek:deepseek-chat');
    expect(json.last_id).toBe('official:claude-sonnet-4');
    expect(json.has_more).toBe(false);
  });

  it('空列表 first_id/last_id 为 null', () => {
    const json = buildAnthropicModelsList([]);
    expect(json.data).toEqual([]);
    expect(json.first_id).toBeNull();
    expect(json.last_id).toBeNull();
  });
});

describe('buildOpenAIModelsList', () => {
  it('OpenAI 官方格式：object=list、owned_by=slug、created=0 占位', () => {
    const json = buildOpenAIModelsList(providers);
    expect(json.object).toBe('list');
    expect(json.data[0]).toEqual({ id: 'deepseek:deepseek-chat', object: 'model', created: 0, owned_by: 'deepseek' });
    expect(json.data).toHaveLength(2);
  });
});
