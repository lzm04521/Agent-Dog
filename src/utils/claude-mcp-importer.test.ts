import { describe, it, expect } from 'vitest';
import {
  parseClaudeJson,
  convertEntryToServerConfig,
  buildImportPlan,
  ClaudeMCPEntry,
} from './claude-mcp-importer';

describe('parseClaudeJson', () => {
  it('should extract top-level mcpServers', () => {
    const content = JSON.stringify({ mcpServers: { alpha: { command: 'npx' } } });
    const result = parseClaudeJson(content);
    expect(Object.keys(result)).toEqual(['alpha']);
  });

  it('should return empty object when no mcpServers field', () => {
    const result = parseClaudeJson(JSON.stringify({ projects: {} }));
    expect(result).toEqual({});
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseClaudeJson('not json')).toThrow(/.claude.json/);
  });

  it('should throw when mcpServers is not an object', () => {
    expect(() => parseClaudeJson(JSON.stringify({ mcpServers: [1, 2] }))).toThrow(/mcpServers/);
  });
});

describe('convertEntryToServerConfig', () => {
  it('should convert stdio entry with command/args/env/cwd', () => {
    const result = convertEntryToServerConfig('filesystem', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      cwd: '/home/user',
      env: { FOO: 'bar' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transport).toBe('stdio');
    expect(result.config.enabled).toBe(true);
    expect(result.config.command).toBe('npx');
    expect(result.config.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
    expect(result.config.cwd).toBe('/home/user');
    expect(result.config.env).toEqual({ FOO: 'bar' });
  });

  it('should convert sse entry to http-sse and keep url + headers', () => {
    const result = convertEntryToServerConfig('remote-sse', {
      type: 'sse',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer x' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transport).toBe('http-sse');
    expect(result.config.url).toBe('https://example.com/mcp');
    expect(result.config.headers).toEqual({ Authorization: 'Bearer x' });
  });

  it('should convert url entry without type to streamable-http', () => {
    const result = convertEntryToServerConfig('remote', {
      url: 'https://example.com/mcp',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transport).toBe('streamable-http');
    expect(result.config.url).toBe('https://example.com/mcp');
  });

  it('should prioritize url over command', () => {
    const result = convertEntryToServerConfig('both', {
      url: 'https://example.com/mcp',
      command: 'npx',
      args: ['server'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transport).toBe('streamable-http');
    expect(result.config).not.toHaveProperty('command');
  });

  it('should import disabled entry with enabled false', () => {
    const result = convertEntryToServerConfig('disabled-srv', {
      command: 'npx',
      disabled: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.enabled).toBe(false);
  });

  it('should reject entry without command or url', () => {
    const result = convertEntryToServerConfig('broken', { env: { A: 'b' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('command 或 url');
  });
});

describe('buildImportPlan', () => {
  // 带注释说明：JSON 解析后同名字段不会重复出现（后者覆盖前者），故不测同文件名称重复
  const entries: Record<string, ClaudeMCPEntry> = {
    'good-stdio': { command: 'npx', args: ['a'] },
    'good-remote': { url: 'https://example.com/mcp', type: 'sse' },
    'already-here': { command: 'node', args: ['x'] }, // 冲突
    'bad name!': { command: 'npx' }, // 名称不合规
    broken: { env: { A: 'b' } }, // 缺 command/url
  };

  const testValidator = (name: string) => {
    if (name === 'config' || name === 'settings') return { valid: false }; // 模拟保留字
    if (!/^[a-zA-Z0-9\-_]+$/.test(name)) return { valid: false };
    return { valid: true };
  };

  it('should classify items into new / conflict / invalid', () => {
    const plan = buildImportPlan({
      source: 'C:/Users/test/.claude.json',
      entries,
      existingNames: ['already-here'],
      validateName: testValidator,
    });

    const byName = Object.fromEntries(plan.items.map(i => [i.name, i]));

    expect(byName['good-stdio'].status).toBe('new');
    expect(byName['good-stdio'].transport).toBe('stdio');
    expect(byName['good-stdio'].config).toBeDefined();

    expect(byName['good-remote'].status).toBe('new');
    expect(byName['good-remote'].transport).toBe('http-sse');

    expect(byName['already-here'].status).toBe('conflict');
    expect(byName['already-here'].config).toBeUndefined();

    expect(byName['bad name!'].status).toBe('invalid');

    expect(byName['broken'].status).toBe('invalid');
    expect(byName['broken'].config).toBeUndefined();
  });

  it('should compute counts correctly', () => {
    const plan = buildImportPlan({
      source: 'any',
      entries,
      existingNames: ['already-here'],
      validateName: testValidator,
    });

    expect(plan.counts.new).toBe(2); // good-stdio, good-remote
    expect(plan.counts.conflict).toBe(1); // already-here
    expect(plan.counts.invalid).toBe(2); // bad name!, broken
  });

  it('should defer reserved-name rejection to the validator', () => {
    const plan = buildImportPlan({
      source: 'any',
      entries: { config: { command: 'npx' } },
      existingNames: [],
      validateName: testValidator,
    });
    expect(plan.items[0].status).toBe('invalid');
    expect(plan.items[0].reason).toBe('服务器名称不合规');
  });
});