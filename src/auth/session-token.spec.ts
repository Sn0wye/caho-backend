import { describe, expect, it } from 'vitest';
import { generateSessionToken, hashToken } from './session-token';

describe('generateSessionToken', () => {
  it('returns a non-empty lowercase base32 token', () => {
    const token = generateSessionToken();

    expect(token.length).toBeGreaterThan(0);
    expect(token).toMatch(/^[a-z2-7]+$/);
  });

  it('produces a fresh token on every call', () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => generateSessionToken())
    );

    expect(tokens.size).toBe(100);
  });
});

describe('hashToken', () => {
  it('maps a token to a 64-char lowercase hex digest', () => {
    expect(hashToken('a-token')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same token', () => {
    expect(hashToken('same')).toBe(hashToken('same'));
  });

  it('yields different digests for different tokens', () => {
    expect(hashToken('one')).not.toBe(hashToken('two'));
  });
});
