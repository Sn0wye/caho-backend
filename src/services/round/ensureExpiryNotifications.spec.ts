import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import {
  ensureExpiryNotifications,
  withExpiredKeyEvents
} from './ensureExpiryNotifications';
import { FakeExpiryRedisSettings } from './ensureExpiryNotifications.fakes';

describe('withExpiredKeyEvents', () => {
  it('enables keyevent + expired from nothing', () => {
    expect(withExpiredKeyEvents('')).toBe('Ex');
  });

  it('keeps existing flags and adds only what is missing', () => {
    expect(withExpiredKeyEvents('Kg')).toBe('KgEx');
  });

  it('treats A as already covering expired events', () => {
    expect(withExpiredKeyEvents('AKE')).toBe('AKE');
  });
});

describe('ensureExpiryNotifications', () => {
  it('keeps existing Redis flags and reports denied CONFIG with a serialized stack', async () => {
    const redis = new FakeExpiryRedisSettings();
    const output = new FakeConsoleOutput();
    const { logger } = buildLogger({ consoleOutput: output });
    redis.flags = 'Kg';
    await ensureExpiryNotifications(redis as unknown as Redis, logger);
    expect(redis.changedFlags).toEqual(['KgEx']);
    redis.denied = true;
    await ensureExpiryNotifications(redis as unknown as Redis, logger);
    expect(JSON.parse(output.lines[0])).toMatchObject({
      event: 'round.expiry_configuration_failed',
      expected: 'Ex',
      err: { message: 'CONFIG permission denied' }
    });
  });
});
