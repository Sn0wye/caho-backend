import { EventEmitter } from 'node:events';
import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import { describe, expect, it } from 'vitest';
import { observeRedis } from './dependency-events';
import { FailureLogWindow } from './failure-log-window';

class FakeRedisConnection extends EventEmitter {}

describe('Redis connection observability', () => {
  it('records failure, retry, recovery and closure without unhandled errors', () => {
    const output = new FakeConsoleOutput();
    const { logger } = buildLogger(undefined, true, output);
    const connection = new FakeRedisConnection();
    observeRedis(connection, logger, 'round-expiry');
    connection.emit('error', new Error('connection refused'));
    connection.emit('reconnecting', 100);
    connection.emit('ready');
    connection.emit('end');
    expect(output.lines.map(line => JSON.parse(line).event)).toEqual([
      'redis.connection_failed',
      'redis.reconnecting',
      'redis.recovered',
      'redis.closed'
    ]);
    expect(JSON.parse(output.lines[1])).toMatchObject({
      connectionRole: 'round-expiry',
      delayMs: 100
    });
  });

  it('caps repeats per connection, reports counts, and resets on recovery', () => {
    const output = new FakeConsoleOutput();
    const { logger } = buildLogger(undefined, true, output);
    const connection = new FakeRedisConnection();
    let timestamp = 0;
    observeRedis(
      connection,
      logger,
      'pubsub',
      new FailureLogWindow(() => timestamp)
    );
    for (let index = 0; index < 100; index++) {
      connection.emit('error', new Error('connection refused'));
      connection.emit('reconnecting', 100);
    }
    expect(output.lines).toHaveLength(2);
    timestamp = 30000;
    connection.emit('error', new Error('still refused'));
    expect(JSON.parse(output.lines[2]).suppressedCount).toBe(99);
    connection.emit('ready');
    expect(JSON.parse(output.lines[3])).toMatchObject({
      event: 'redis.recovered',
      suppressedCount: 99
    });
    connection.emit('error', new Error('new outage'));
    expect(JSON.parse(output.lines[4]).suppressedCount).toBe(0);
  });

  it('keeps healthy per-socket connection churn below info level', () => {
    const output = new FakeConsoleOutput();
    const { logger } = buildLogger(undefined, true, output);
    const connection = new FakeRedisConnection();
    observeRedis(connection, logger, 'pubsub');
    connection.emit('ready');
    connection.emit('end');
    expect(output.lines).toHaveLength(0);
  });
});
