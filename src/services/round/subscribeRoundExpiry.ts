import type { Redis } from 'ioredis';
import { logger } from '@/lib/logger';
import type { RoundTimekeeper } from './RoundTimekeeper';

// Redis emits expired-key events on the `__keyevent@<db>__:expired` channel when
// `notify-keyspace-events Ex` is enabled (a deployment prerequisite, ADR-0003).
const expiredChannel = (db: number): string => `__keyevent@${db}__:expired`;

// Subscribe to expired-key events on a dedicated connection (a subscribed ioredis
// client can't run other commands) and hand each expired key to the timekeeper.
// Returns an unsubscribe to release the connection on shutdown. See issue #4.
export async function subscribeRoundExpiry(
  redis: Redis,
  timekeeper: RoundTimekeeper,
  db = 0
): Promise<() => Promise<void>> {
  const sub = redis.duplicate();
  const channel = expiredChannel(db);

  sub.on('message', (_channel, expiredKey) => {
    timekeeper.onExpired(expiredKey).catch(error => {
      logger.warn({ expiredKey, error }, 'round expiry handling failed');
    });
  });

  await sub.subscribe(channel);

  return async () => {
    await sub.unsubscribe(channel);
    sub.quit();
  };
}
