import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildLogger } from './logger';

class FakeConsoleOutput extends Writable {
  readonly lines: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.lines.push(chunk.toString());
    callback();
  }
}

describe('production logger', () => {
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
