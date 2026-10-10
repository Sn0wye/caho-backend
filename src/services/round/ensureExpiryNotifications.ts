import type { Redis } from 'ioredis';
import { logger } from '@/lib/logger';

const SETTING = 'notify-keyspace-events';

// Add the flags the Round timers need to an existing keyspace-events setting:
// `E` (keyevent channel) and `x` (expired). `A` already implies `x`. Keeps any
// flags another consumer set. Example: withExpiredKeyEvents('') === 'Ex'.
export const withExpiredKeyEvents = (flags: string): string => {
  let next = flags;
  if (!next.includes('E')) next += 'E';
  if (!next.includes('x') && !next.includes('A')) next += 'x';
  return next;
};

// Redis ships with keyspace events off, and the compose file never enabled them,
// so no Round timer ever fired (ADR-0003). Turn them on at boot; a managed Redis
// may forbid CONFIG, in which case the server config must set it.
export async function ensureExpiryNotifications(redis: Redis): Promise<void> {
  try {
    const [, current = ''] = (await redis.config('GET', SETTING)) as string[];
    const wanted = withExpiredKeyEvents(current);
    if (wanted !== current) {
      await redis.config('SET', SETTING, wanted);
    }
  } catch (error) {
    logger.warn(
      { error, setting: SETTING, expected: 'Ex' },
      'could not enable Redis expired-key events; Round timers will not fire'
    );
  }
}
