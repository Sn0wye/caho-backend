import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  createBlankSessionCookie,
  createSessionCookie,
  readBearerToken,
  readSessionCookie
} from './session-cookie';

describe('createSessionCookie', () => {
  it('carries the token under the session cookie name with hardened attributes', () => {
    const cookie = createSessionCookie('tok123');

    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie.value).toBe('tok123');
    expect(cookie.attributes.httpOnly).toBe(true);
    expect(cookie.attributes.sameSite).toBe('lax');
    expect(cookie.attributes.path).toBe('/');
    expect(cookie.attributes.maxAge).toBeGreaterThan(0);
  });
});

describe('createBlankSessionCookie', () => {
  it('empties the value and expires the cookie immediately', () => {
    const cookie = createBlankSessionCookie();

    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie.value).toBe('');
    expect(cookie.attributes.maxAge).toBe(0);
  });
});

describe('readSessionCookie', () => {
  it('extracts the session token from a Cookie header', () => {
    const header = `foo=bar; ${SESSION_COOKIE_NAME}=tok123; baz=qux`;

    expect(readSessionCookie(header)).toBe('tok123');
  });

  it('returns null when the session cookie is absent', () => {
    expect(readSessionCookie('foo=bar')).toBeNull();
    expect(readSessionCookie('')).toBeNull();
  });
});

describe('readBearerToken', () => {
  it('extracts the token from a Bearer Authorization header', () => {
    expect(readBearerToken('Bearer tok123')).toBe('tok123');
  });

  it('returns null for missing or non-Bearer headers', () => {
    expect(readBearerToken('')).toBeNull();
    expect(readBearerToken('Basic abc')).toBeNull();
  });
});
