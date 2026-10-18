import type { RoomEvent } from '@/contracts';
import { TelemetryTestHarness } from '@/lib/telemetry.fakes';
import { traceOperation } from '@/lib/tracing';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { buildLogger } from './logger';
import { FakeConsoleOutput } from './logger.fakes';
import { Pubsub } from './pub-sub';
import { FakeRedisPubsub } from './pub-sub.fakes';

const event: RoomEvent = {
  event: 'room.player-left',
  payload: { id: 'player-a' }
};

describe('CAHO Pub/Sub namespace', () => {
  it('prefixes room and player channels before publishing', async () => {
    const redis = new FakeRedisPubsub();
    const pubsub = new Pubsub(redis as unknown as Redis);
    await pubsub.publish('ABC123', event);
    await pubsub.publish('player-a', event);
    expect(redis.published).toEqual([
      { channel: 'caho:ABC123', message: JSON.stringify(event) },
      { channel: 'caho:player-a', message: JSON.stringify(event) }
    ]);
  });

  it('receives only its prefixed channel and releases that subscription', async () => {
    const redis = new FakeRedisPubsub();
    const pubsub = new Pubsub(redis as unknown as Redis);
    const received = vi.fn();
    const unsubscribe = await pubsub.subscribe('ABC123', received);
    const connection = redis.connections[0];
    expect(connection.subscribed).toEqual(['caho:ABC123']);
    connection.emit('message', 'other:ABC123', JSON.stringify(event));
    connection.emit('message', 'caho:ABC123', JSON.stringify(event));
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(event);
    await unsubscribe();
    expect(connection.unsubscribed).toEqual(['caho:ABC123']);
    await pubsub.close();
    expect(connection.closed).toBe(true);
  });

  // issue #26: one subscriber connection per app, not one per socket.
  it('shares one subscriber connection and unsubscribes a channel after its last receiver', async () => {
    const redis = new FakeRedisPubsub();
    const pubsub = new Pubsub(redis as unknown as Redis);
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = await pubsub.subscribe('ABC123', first);
    const stopSecond = await pubsub.subscribe('ABC123', second);
    const stopOther = await pubsub.subscribe('player-a', vi.fn());
    const [connection] = redis.connections;
    expect(redis.connections).toHaveLength(1);
    expect(connection.subscribed).toEqual(['caho:ABC123', 'caho:player-a']);
    connection.emit('message', 'caho:ABC123', JSON.stringify(event));
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith(event));
    expect(first).toHaveBeenCalledWith(event);
    await stopFirst();
    expect(connection.unsubscribed).toEqual([]);
    await stopSecond();
    await stopOther();
    expect(connection.unsubscribed).toEqual(['caho:ABC123', 'caho:player-a']);
  });
});

describe('Pub/Sub observability', () => {
  it('propagates the publishing trace and strips internal context before delivery', async () => {
    const harness = new TelemetryTestHarness();
    harness.start();
    const redis = new FakeRedisPubsub();
    const pubsub = new Pubsub(redis as unknown as Redis);
    const received = vi.fn();
    try {
      const unsubscribe = await pubsub.subscribe('ABC123', received);
      await traceOperation('request', {}, () =>
        pubsub.publish('ABC123', event)
      );
      const message = redis.published[0].message;
      expect(JSON.parse(message).__cahoTrace.traceparent).toBeDefined();
      redis.connections[0].emit('message', 'caho:ABC123', message);
      await vi.waitFor(() => expect(received).toHaveBeenCalledWith(event));
      const spans = harness.exporter.getFinishedSpans();
      expect(new Set(spans.map(span => span.spanContext().traceId)).size).toBe(
        1
      );
      expect(spans.map(span => span.name)).toContain('pubsub.deliver');
      await unsubscribe();
    } finally {
      await harness.close();
    }
  });

  // ADR-0006: cursors move ~20 times a second per Player; tracing each would
  // flood Seq.
  it('relays cursor events without spans, trace context or debug logs', async () => {
    const harness = new TelemetryTestHarness();
    harness.start();
    const redis = new FakeRedisPubsub();
    const output = new FakeConsoleOutput();
    const { logger } = buildLogger({
      consoleOutput: output,
      settings: {
        level: 'debug',
        serviceName: 'caho-backend',
        serviceVersion: 'test',
        environment: 'test'
      }
    });
    const pubsub = new Pubsub(redis as unknown as Redis, logger);
    const cursor: RoomEvent = {
      event: 'room.cursor-move',
      payload: { playerId: 'player-a', x: 0.5, y: -0.25 }
    };
    const received = vi.fn();
    try {
      const unsubscribe = await pubsub.subscribe('ABC123', received);
      await traceOperation('request', {}, () =>
        pubsub.publish('ABC123', cursor)
      );
      const message = redis.published[0].message;
      expect(JSON.parse(message)).toEqual(cursor);
      redis.connections[0].emit('message', 'caho:ABC123', message);
      await vi.waitFor(() => expect(received).toHaveBeenCalledWith(cursor));
      const spanNames = harness.exporter
        .getFinishedSpans()
        .map(span => span.name);
      expect(spanNames).toEqual(['request']);
      expect(output.lines).toEqual([]);
      await unsubscribe();
    } finally {
      await harness.close();
    }
  });

  it('logs malformed messages without their contents and catches callback failures', async () => {
    const redis = new FakeRedisPubsub();
    const output = new FakeConsoleOutput();
    const { logger } = buildLogger({ consoleOutput: output });
    const pubsub = new Pubsub(redis as unknown as Redis, logger);
    const unsubscribe = await pubsub.subscribe('ABC123', () => {
      throw new Error('send failed');
    });
    redis.connections[0].emit('message', 'caho:ABC123', '{private-message');
    redis.connections[0].emit('message', 'caho:ABC123', 'null');
    redis.connections[0].emit('message', 'caho:ABC123', JSON.stringify(event));
    await vi.waitFor(() => expect(output.lines).toHaveLength(3));
    expect(output.lines.join('')).not.toContain('private-message');
    expect(output.lines.map(line => JSON.parse(line).event)).toEqual([
      'pubsub.invalid_message',
      'pubsub.invalid_message',
      'pubsub.delivery_failed'
    ]);
    await unsubscribe();
  });

  it('logs publishing and subscribe failures', async () => {
    const redis = new FakeRedisPubsub();
    redis.publishError = new Error('publish failed');
    redis.subscribeError = new Error('subscribe failed');
    const output = new FakeConsoleOutput();
    const { logger } = buildLogger({ consoleOutput: output });
    const pubsub = new Pubsub(redis as unknown as Redis, logger);
    await expect(pubsub.publish('ABC123', event)).rejects.toThrow(
      'publish failed'
    );
    await expect(pubsub.subscribe('ABC123', () => {})).rejects.toThrow(
      'subscribe failed'
    );
    expect(output.lines.map(line => JSON.parse(line).event)).toEqual([
      'pubsub.publish_failed',
      'redis.subscription_failed'
    ]);
  });

  it('still quits the shared subscriber after an unsubscribe fails', async () => {
    const redis = new FakeRedisPubsub();
    redis.unsubscribeError = new Error('unsubscribe failed');
    const pubsub = new Pubsub(redis as unknown as Redis);
    const unsubscribe = await pubsub.subscribe('ABC123', () => {});
    await expect(unsubscribe()).rejects.toThrow('unsubscribe failed');
    await pubsub.close();
    expect(redis.connections[0].closed).toBe(true);
  });
});
