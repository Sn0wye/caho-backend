import { openRedisSubscription } from '@/lib/redis-subscription';
import { traceBackground } from '@/observability/operations';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { RoundTimekeeper } from './RoundTimekeeper';
import { parseDeadlineKey } from './deadlineKeys';

// Redis emits expired-key events on the `__keyevent@<db>__:expired` channel when
// `notify-keyspace-events Ex` is enabled (a deployment prerequisite, ADR-0003).
const expiredChannel = (db: number): string => `__keyevent@${db}__:expired`;

export type RoundExpiryDriver = Pick<RoundTimekeeper, 'onExpired'>;

// Subscribe to expired-key events on a dedicated connection (a subscribed ioredis
// client can't run other commands) and hand each expired key to the timekeeper.
// Returns an unsubscribe to release the connection on shutdown. See issue #4.
export async function subscribeRoundExpiry(
  redis: Redis,
  timekeeper: RoundExpiryDriver,
  log: Logger,
  db = 0
): Promise<() => Promise<void>> {
  const sub = redis.duplicate();
  const pending = listenRoundExpiry(sub, timekeeper, log);
  const cleanup = await openRedisSubscription(
    sub,
    expiredChannel(db),
    log,
    'round-expiry'
  );
  return async () => {
    try {
      await cleanup();
    } finally {
      await Promise.all(pending);
    }
  };
}

function listenRoundExpiry(
  subscriber: Redis,
  timekeeper: RoundExpiryDriver,
  log: Logger
): Set<Promise<void>> {
  const pending = new Set<Promise<void>>();
  subscriber.on('message', (_channel: string, expiredKey: string) => {
    const work = handleRoundExpiry(expiredKey, timekeeper, log);
    if (!work) return;
    pending.add(work);
    void work.then(() => pending.delete(work));
  });
  return pending;
}

function handleRoundExpiry(
  expiredKey: string,
  timekeeper: RoundExpiryDriver,
  log: Logger
): Promise<void> | null {
  const deadline = parseDeadlineKey(expiredKey);
  if (!deadline) return null;
  return traceBackground(
    'round.expiry',
    { roundId: deadline.roundId, deadlineKind: deadline.kind },
    async () => {
      try {
        await timekeeper.onExpired(expiredKey);
      } catch (err) {
        log.error(
          { event: 'round.expiry_failed', ...deadline, err },
          'Round expiry handling failed'
        );
        throw err;
      }
    }
  ).catch(() => undefined); // Failure already logged within its trace context.
}
