import { describe, it, expect } from 'vitest';
import { estimateTokens } from './count-tokens.js';

describe('estimateTokens', () => {
  it('纯 ASCII 按字符数/3.5 估算', () => {
    expect(estimateTokens('a'.repeat(35))).toBe(10);
  });

  it('CJK 权重高于 ASCII', () => {
    const cjk = estimateTokens('中'.repeat(10));
    const ascii = estimateTokens('a'.repeat(10));
    expect(cjk).toBe(10);
    expect(ascii).toBe(3);
  });

  it('混合输入且输出为正整数', () => {
    const t = estimateTokens('你好 world');
    expect(Number.isInteger(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
  });
});
