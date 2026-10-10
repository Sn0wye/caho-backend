import type { EventEmitter } from 'node:events';
import type { Logger } from 'pino';
import { FailureLogWindow } from './failure-log-window';

/** Track Redis connection state without connection URLs. Example: observeRedis(redis, logger, 'primary'). */
export function observeRedis(
  connection: EventEmitter,
  log: Logger,
  connectionRole: string,
  failures: FailureLogWindow = new FailureLogWindow(Date.now)
): void {
  observeRedisFailures(connection, log, connectionRole, failures);
  observeRedisLifecycle(connection, log, connectionRole, failures);
}

function observeRedisFailures(
  connection: EventEmitter,
  log: Logger,
  connectionRole: string,
  failures: FailureLogWindow
): void {
  connection.on('error', (err: Error) => {
    writeRedisError(log, connectionRole, failures, err);
  });
  connection.on('reconnecting', (delayMs: number) => {
    const suppressedCount = failures.allow('reconnecting');
    if (suppressedCount === null) return;
    log.warn(
      { event: 'redis.reconnecting', connectionRole, delayMs, suppressedCount },
      'Redis reconnecting'
    );
  });
}

function writeRedisError(
  log: Logger,
  connectionRole: string,
  failures: FailureLogWindow,
  err: Error
): void {
  const suppressedCount = failures.allow('error');
  if (suppressedCount === null) return;
  log.error(
    { event: 'redis.connection_failed', connectionRole, err, suppressedCount },
    'Redis connection failed'
  );
}

function observeRedisLifecycle(
  connection: EventEmitter,
  log: Logger,
  connectionRole: string,
  failures: FailureLogWindow
): void {
  connection.on('ready', () => writeRedisReady(log, connectionRole, failures));
  connection.on('end', () => {
    log[connectionRole === 'pubsub' ? 'debug' : 'info'](
      { event: 'redis.closed', connectionRole },
      'Redis connection closed'
    );
  });
}

function writeRedisReady(
  log: Logger,
  connectionRole: string,
  failures: FailureLogWindow
): void {
  const errorRepeats = failures.recover('error');
  const retryRepeats = failures.recover('reconnecting');
  const recovered = errorRepeats !== null || retryRepeats !== null;
  const level = recovered || connectionRole !== 'pubsub' ? 'info' : 'debug';
  log[level](
    {
      event: recovered ? 'redis.recovered' : 'redis.ready',
      connectionRole,
      suppressedCount: recovered
        ? (errorRepeats ?? 0) + (retryRepeats ?? 0)
        : undefined
    },
    recovered ? 'Redis connection recovered' : 'Redis connection ready'
  );
}
