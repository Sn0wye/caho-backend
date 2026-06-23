import { describe, expect, it } from 'vitest';
import {
  SESSION_DURATION_MS,
  assessSession,
  freshExpiry
} from './session-lifetime';

const DAY = 24 * 60 * 60 * 1000;

describe('assessSession', () => {
  it('flags a session as expired once the deadline passed', () => {
    const now = new Date('2026-06-23T00:00:00Z');
    const expiresAt = new Date(now.getTime() - 1);

    expect(assessSession(expiresAt, now).expired).toBe(true);
  });

  it('leaves a far-from-expiry session untouched (not fresh)', () => {
    const now = new Date('2026-06-23T00:00:00Z');
    const expiresAt = new Date(now.getTime() + 20 * DAY);

    const result = assessSession(expiresAt, now);

    expect(result.expired).toBe(false);
    expect(result.fresh).toBe(false);
    expect(result.expiresAt).toEqual(expiresAt);
  });

  it('renews a session past the halfway point, extending the deadline', () => {
    const now = new Date('2026-06-23T00:00:00Z');
    const expiresAt = new Date(now.getTime() + 10 * DAY);

    const result = assessSession(expiresAt, now);

    expect(result.expired).toBe(false);
    expect(result.fresh).toBe(true);
    expect(result.expiresAt.getTime()).toBe(now.getTime() + SESSION_DURATION_MS);
  });
});

describe('freshExpiry', () => {
  it('returns now plus the full session duration', () => {
    const now = new Date('2026-06-23T00:00:00Z');

    expect(freshExpiry(now).getTime()).toBe(now.getTime() + SESSION_DURATION_MS);
  });
});
