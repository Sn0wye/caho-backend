import type { EventEmitter } from 'node:events';
import type { Logger } from 'pino';

/** Track Redis connection state without connection URLs. Example: observeRedis(redis, logger, 'primary'). */
export function observeRedis(
  connection: EventEmitter,
  log: Logger,
  connectionRole: string
): void {
  observeRedisFailures(connection, log, connectionRole);
  observeRedisLifecycle(connection, log, connectionRole);
}

function observeRedisFailures(
  connection: EventEmitter,
  log: Logger,
  connectionRole: string
): void {
  connection.on('error', (err: Error) => {
    log.error(
      { event: 'redis.connection_failed', connectionRole, err },
      'Redis connection failed'
    );
  });
  connection.on('reconnecting', (delayMs: number) => {
    log.warn(
      { event: 'redis.reconnecting', connectionRole, delayMs },
      'Redis reconnecting'
    );
  });
}

function observeRedisLifecycle(
  connection: EventEmitter,
  log: Logger,
  connectionRole: string
): void {
  connection.on('ready', () => {
    log[connectionRole === 'pubsub' ? 'debug' : 'info'](
      { event: 'redis.ready', connectionRole },
      'Redis connection ready'
    );
  });
  connection.on('end', () => {
    log[connectionRole === 'pubsub' ? 'debug' : 'info'](
      { event: 'redis.closed', connectionRole },
      'Redis connection closed'
    );
  });
}
