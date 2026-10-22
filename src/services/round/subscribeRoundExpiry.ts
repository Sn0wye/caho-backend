import { openRedisSubscription } from '@/lib/redis-events';
import { traceBackground } from '@/lib/tracing';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { RoundLifecycle } from './RoundLifecycle';
import { parseDeadlineKey } from './deadlineKeys';

// Redis emits expired-key events on the `__keyevent@<db>__:expired` channel when
// `notify-keyspace-events Ex` is enabled (a deployment prerequisite, ADR-0003).
const expiredChannel = (db: number): string => `__keyevent@${db}__:expired`;

export type RoundExpiryDriver = Pick<RoundLifecycle, 'onExpired'>;

// Subscribe to expired-key events on a dedicated connection (a subscribed ioredis
// client can't run other commands) and hand each expired key to the Round lifecycle.
// `onReconnected` runs once the connection is back after a drop: events expired
// while it was down are lost, so the caller sweeps. Returns an unsubscribe to
// release the connection on shutdown. See issue #4.
export async function subscribeRoundExpiry(
  redis: Redis,
  rounds: RoundExpiryDriver,
  log: Logger,
  db = 0,
  onReconnected: () => void = () => {}
): Promise<() => Promise<void>> {
  const sub = redis.duplicate();
  const pending = listenRoundExpiry(sub, rounds, log);
  watchReconnects(sub, onReconnected);
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

// ioredis emits `ready` on the first connect too, so only a `ready` after a
// `reconnecting` counts. ioredis resubscribes by itself on reconnect.
function watchReconnects(subscriber: Redis, onReconnected: () => void): void {
  let dropped = false;
  subscriber.on('reconnecting', () => {
    dropped = true;
  });
  subscriber.on('ready', () => {
    if (!dropped) return;
    dropped = false;
    onReconnected();
  });
}

function listenRoundExpiry(
  subscriber: Redis,
  rounds: RoundExpiryDriver,
  log: Logger
): Set<Promise<void>> {
  const pending = new Set<Promise<void>>();
  subscriber.on('message', (_channel: string, expiredKey: string) => {
    const work = handleRoundExpiry(expiredKey, rounds, log);
    if (!work) return;
    pending.add(work);
    void work.then(() => pending.delete(work));
  });
  return pending;
}

function handleRoundExpiry(
  expiredKey: string,
  rounds: RoundExpiryDriver,
  log: Logger
): Promise<void> | null {
  const deadline = parseDeadlineKey(expiredKey);
  if (!deadline) return null;
  return traceBackground(
    'round.expiry',
    { roundId: deadline.roundId, deadlineKind: deadline.kind },
    async () => {
      try {
        await rounds.onExpired(expiredKey);
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
