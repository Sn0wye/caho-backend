import { Writable } from 'node:stream';
import type { PinoSeqStreamConfig } from 'pino-seq';

export class FakeConsoleOutput extends Writable {
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

export class FakeSeqOutput extends FakeConsoleOutput {
  constructor(readonly config: PinoSeqStreamConfig) {
    super();
  }
}
