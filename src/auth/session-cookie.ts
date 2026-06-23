import { env } from '@/env';
import { SESSION_DURATION_MS } from './session-lifetime';

// Cookie helpers replacing lucia's `auth.createSessionCookie` /
// `readSessionCookie` / `readBearerToken`. Shape `{ name, value, attributes }`
// is preserved so controllers keep calling `res.setCookie(name, value, attrs)`.

export const SESSION_COOKIE_NAME = 'auth_session';

type CookieAttributes = {
  httpOnly: boolean;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  maxAge: number;
};

export type SessionCookie = {
  name: string;
  value: string;
  attributes: CookieAttributes;
};

function baseAttributes(maxAge: number): CookieAttributes {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: env.NODE_ENV === 'production',
    maxAge
  };
}

export function createSessionCookie(token: string): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    attributes: baseAttributes(Math.floor(SESSION_DURATION_MS / 1000))
  };
}

export function createBlankSessionCookie(): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: '',
    attributes: baseAttributes(0)
  };
}

export function readSessionCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE_NAME && rest.length > 0) {
      return rest.join('=');
    }
  }
  return null;
}

export function readBearerToken(authorizationHeader: string): string | null {
  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }
  return token;
}
