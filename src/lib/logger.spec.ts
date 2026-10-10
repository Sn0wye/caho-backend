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
