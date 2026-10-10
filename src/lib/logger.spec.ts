import { traceOperation } from '@/observability/operations';
import { TelemetryTestHarness } from '@/observability/telemetry.fakes';
import type { PinoSeqStreamConfig } from 'pino-seq';
import { describe, expect, it, vi } from 'vitest';
import { buildLogger } from './logger';
import { FakeConsoleOutput, FakeSeqOutput } from './logger.fakes';

vi.mock('pino-seq', async () => {
  const { FakeSeqOutput } = await import('./logger.fakes');
  return {
    createStream: vi.fn(
      (config: PinoSeqStreamConfig) => new FakeSeqOutput(config)
    )
  };
});

describe('production logger', () => {
  it('ships logs with the configured API key without logging that secret', () => {
    const consoleOutput = new FakeConsoleOutput();
    const { logger, seqStream } = buildLogger(
      'http://seq:5341',
      true,
      consoleOutput,
      'caho-ingest-test-key'
    );
    expect(seqStream).toBeInstanceOf(FakeSeqOutput);
    if (!(seqStream instanceof FakeSeqOutput))
      throw new Error('Expected FakeSeqOutput');
    expect(seqStream.config).toMatchObject({
      serverUrl: 'http://seq:5341',
      apiKey: 'caho-ingest-test-key'
    });
    logger.info({ roomCode: 'ABC123' }, 'round started');
    expect(seqStream.lines).toHaveLength(1);
    expect(consoleOutput.lines.join('')).not.toContain('caho-ingest-test-key');
  });

  it('writes structured JSON directly to the supplied console stream', () => {
    const consoleOutput = new FakeConsoleOutput();
    const { logger, seqStream } = buildLogger(undefined, true, consoleOutput);
    logger.info({ roomCode: 'ABC123' }, 'round started');

    expect(seqStream).toBeNull();
    expect(consoleOutput.lines).toHaveLength(1);
    expect(JSON.parse(consoleOutput.lines[0])).toMatchObject({
      level: 30,
      roomCode: 'ABC123',
      msg: 'round started'
    });
  });

  it('keeps error details without pretty-printing overhead', () => {
    const consoleOutput = new FakeConsoleOutput();
    const { logger } = buildLogger(undefined, true, consoleOutput);
    logger.error({ err: new Error('Redis unavailable') }, 'timer failed');

    expect(JSON.parse(consoleOutput.lines[0])).toMatchObject({
      level: 50,
      err: { message: 'Redis unavailable' },
      msg: 'timer failed'
    });
  });
});

describe('logging policy', () => {
  it('redacts secrets and private game payloads from both log outputs', () => {
    const output = new FakeConsoleOutput();
    const { logger, seqStream } = buildLogger('http://seq:80', true, output);
    logger.info(
      {
        password: 'private-password',
        token: 'private-token',
        path: '/ws/unknown?token=private-upgrade-token',
        payload: { cards: ['private-card'] },
        req: {
          headers: { authorization: 'private-header' },
          url: '/callback?code=private-code',
          body: { password: 'private-body' }
        },
        user: { email: 'private-email', sessionId: 'private-session' }
      },
      'safe event'
    );
    expect(output.lines.join('')).not.toMatch(/private-/);
    expect((seqStream as unknown as FakeSeqOutput).lines.join('')).not.toMatch(
      /private-/
    );
    expect(JSON.parse(output.lines[0]).password).toBe('[REDACTED]');
  });

  it('keeps error causes and stacks but drops driver-specific secret fields', () => {
    const output = new FakeConsoleOutput();
    const { logger } = buildLogger(undefined, true, output);
    const err = Object.assign(
      new Error('query failed', { cause: new Error('connection lost') }),
      { detail: 'private-query-value', query: 'private-sql' }
    );
    logger.error({ err }, 'failure');
    const record = JSON.parse(output.lines[0]);
    expect(record.err.stack).toContain('connection lost');
    expect(output.lines.join('')).not.toMatch(/private-/);
  });

  it('sends configured debug events to both streams with service identity', () => {
    const output = new FakeConsoleOutput();
    const { logger, seqStream } = buildLogger(
      'http://seq:80',
      false,
      output,
      undefined,
      {
        level: 'debug',
        serviceName: 'game-api',
        serviceVersion: '1.2.3',
        environment: 'test'
      }
    );
    logger.debug({ event: 'pubsub.published' }, 'debug event');
    expect(JSON.parse(output.lines[0])).toMatchObject({
      service: 'game-api',
      serviceVersion: '1.2.3',
      environment: 'test',
      level: 20
    });
    expect((seqStream as unknown as FakeSeqOutput).lines).toHaveLength(1);
  });

  it('uses Seq-native trace fields only inside an active span', async () => {
    const harness = new TelemetryTestHarness();
    harness.start();
    const output = new FakeConsoleOutput();
    const { logger } = buildLogger(undefined, true, output);
    try {
      logger.info('outside trace');
      await traceOperation('round.test', {}, async () => {
        logger.info('inside trace');
      });
      expect(JSON.parse(output.lines[0]).trace_id).toBeUndefined();
      expect(JSON.parse(output.lines[1]).trace_id).toMatch(/^[0-9a-f]{32}$/);
      expect(JSON.parse(output.lines[1]).span_id).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      await harness.close();
    }
  });

  it('reports Seq failures to console without sending them back to Seq', () => {
    const output = new FakeConsoleOutput();
    const { seqStream } = buildLogger('http://seq:80', true, output);
    const fake = seqStream as unknown as FakeSeqOutput;
    fake.config.onError?.(new Error('private-api-key'));
    expect(JSON.parse(output.lines[0]).event).toBe('seq.export_failed');
    expect(output.lines.join('')).not.toContain('private-api-key');
    expect(fake.lines).toHaveLength(0);
  });
});
