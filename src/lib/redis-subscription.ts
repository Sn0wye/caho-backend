import { observeRedis } from '@/observability/dependency-events';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

/** Open a dedicated subscriber and release it on failure or cleanup. Example: await openRedisSubscription(sub, channel, logger, 'pubsub'). */
export async function openRedisSubscription(
  subscriber: Redis,
  channel: string,
  log?: Logger,
  connectionRole = 'pubsub'
): Promise<() => Promise<void>> {
  if (log) observeRedis(subscriber, log, connectionRole);
  try {
    await subscriber.subscribe(channel);
  } catch (err) {
    subscriber.disconnect();
    log?.error(
      { event: 'redis.subscription_failed', channel, connectionRole, err },
      'Redis subscription failed'
    );
    throw err;
  }
  return async () => {
    try {
      await subscriber.unsubscribe(channel);
    } finally {
      await subscriber.quit();
    }
  };
}
