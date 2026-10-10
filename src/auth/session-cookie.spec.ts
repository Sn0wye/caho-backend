import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('session cookie domain', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('scopes set and blank cookies to COOKIE_DOMAIN when configured', async () => {
    vi.stubEnv('COOKIE_DOMAIN', 'caho.com.br');
    vi.resetModules();
    const cookies = await import('./session-cookie');

    expect(cookies.createSessionCookie('tok').attributes.domain).toBe(
      'caho.com.br'
    );
    expect(cookies.createBlankSessionCookie().attributes.domain).toBe(
      'caho.com.br'
    );
  });

  it('keeps a host-only cookie when COOKIE_DOMAIN is empty', async () => {
    vi.stubEnv('COOKIE_DOMAIN', '');
    vi.resetModules();
    const cookies = await import('./session-cookie');

    expect(cookies.createSessionCookie('tok').attributes.domain).toBeUndefined();
  });
});
