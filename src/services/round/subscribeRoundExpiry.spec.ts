import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import { FakeRedisPubsub } from '@/lib/pub-sub.fakes';
import { TelemetryTestHarness } from '@/lib/telemetry.fakes';
import { SpanStatusCode } from '@opentelemetry/api';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { subscribeRoundExpiry } from './subscribeRoundExpiry';
import { FakeRoundExpiryDriver } from './subscribeRoundExpiry.fakes';

describe('subscribeRoundExpiry', () => {
  it('waits for in-flight expiry work before shutdown completes', async () => {
    const redis = new FakeRedisPubsub();
    const driver = new FakeRoundExpiryDriver();
    const { logger } = buildLogger({ consoleOutput: new FakeConsoleOutput() });
    let finishExpiry: () => void = () => {};
    driver.delay = new Promise<void>(resolve => {
      finishExpiry = resolve;
    });
    const cleanup = await subscribeRoundExpiry(
      redis as unknown as Redis,
      driver,
      logger
    );
    redis.connections[0].emit(
      'message',
      '__keyevent@0__:expired',
      'caho:round:round-a:play'
    );
    let drained = false;
    const draining = cleanup().then(() => {
      drained = true;
    });
    await vi.waitFor(() => expect(redis.connections[0].closed).toBe(true));
    expect(drained).toBe(false);
    finishExpiry();
    await draining;
    expect(drained).toBe(true);
  });
  it('uses the configured Redis database and logs failures inside a bounded root trace', async () => {
    const harness = new TelemetryTestHarness();
    harness.start();
    const redis = new FakeRedisPubsub();
    const driver = new FakeRoundExpiryDriver();
    driver.failure = new Error('transition failed');
    const output = new FakeConsoleOutput();
    const { logger } = buildLogger({ consoleOutput: output });
    try {
      const cleanup = await subscribeRoundExpiry(
        redis as unknown as Redis,
        driver,
        logger,
        3
      );
      const subscriber = redis.connections[0];
      expect(subscriber.subscribed).toEqual(['__keyevent@3__:expired']);
      subscriber.emit(
        'message',
        '__keyevent@3__:expired',
        'session:private-key'
      );
      subscriber.emit(
        'message',
        '__keyevent@3__:expired',
        'caho:round:round-a:judge'
      );
      await vi.waitFor(() => expect(output.lines).toHaveLength(1));
      expect(driver.expiredKeys).toEqual(['caho:round:round-a:judge']);
      const record = JSON.parse(output.lines[0]);
      expect(record).toMatchObject({
        event: 'round.expiry_failed',
        roundId: 'round-a',
        kind: 'judge',
        level: 50
      });
      await vi.waitFor(() =>
        expect(harness.exporter.getFinishedSpans()).toHaveLength(1)
      );
      expect(harness.exporter.getFinishedSpans()[0].spanContext().traceId).toBe(
        record.trace_id
      );
      expect(harness.exporter.getFinishedSpans()[0].status.code).toBe(
        SpanStatusCode.ERROR
      );
      await cleanup();
      expect(subscriber.closed).toBe(true);
    } finally {
      await harness.close();
    }
  });
});
