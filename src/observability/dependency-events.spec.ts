import { EventEmitter } from 'node:events';
import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import { describe, expect, it } from 'vitest';
import { observeRedis } from './dependency-events';

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
      'redis.ready',
      'redis.closed'
    ]);
    expect(JSON.parse(output.lines[1])).toMatchObject({
      connectionRole: 'round-expiry',
      delayMs: 100
    });
  });
});
