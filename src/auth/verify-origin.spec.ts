import { describe, expect, it } from 'vitest';
import { verifyRequestOrigin } from './verify-origin';

describe('verifyRequestOrigin', () => {
  it('accepts an origin whose host matches an allowed host', () => {
    expect(verifyRequestOrigin('https://caho.app', ['caho.app'])).toBe(true);
  });

  it('matches host case-insensitively', () => {
    expect(verifyRequestOrigin('https://CAHO.app', ['caho.app'])).toBe(true);
  });

  it('rejects an origin from a different host', () => {
    expect(verifyRequestOrigin('https://evil.com', ['caho.app'])).toBe(false);
  });

  it('rejects an empty origin', () => {
    expect(verifyRequestOrigin('', ['caho.app'])).toBe(false);
  });

  it('rejects a malformed origin', () => {
    expect(verifyRequestOrigin('not a url', ['caho.app'])).toBe(false);
  });

  it('compares including port when the allowed entry carries one', () => {
    expect(
      verifyRequestOrigin('http://localhost:3000', ['localhost:3000'])
    ).toBe(true);
    expect(
      verifyRequestOrigin('http://localhost:4000', ['localhost:3000'])
    ).toBe(false);
  });
});
