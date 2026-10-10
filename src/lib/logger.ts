import pino from 'pino';
import { createStream } from 'pino-seq';
import { env } from '@/env';

type SeqStream = ReturnType<typeof createStream>;

/** Create console logging and optional Seq shipping. Example: buildLogger(undefined, true). */
export function buildLogger(
  seqUrl?: string,
  production: boolean = false,
  consoleOutput: NodeJS.WritableStream = process.stdout,
  seqApiKey?: string
): {
  logger: pino.Logger;
  seqStream: SeqStream | null;
} {
  // Production writes JSON directly, avoiding a worker just to format log lines.
  const consoleStream = production
    ? consoleOutput
    : pino.transport({ target: '@fastify/one-line-logger' });
  const seqStream = seqUrl
    ? createStream({ serverUrl: seqUrl, apiKey: seqApiKey })
    : null;
  const streams: pino.StreamEntry[] = [{ stream: consoleStream }];
  // pino-seq stream is Writable-compatible; cast needed for type alignment
  if (seqStream)
    streams.push({ stream: seqStream as unknown as NodeJS.WritableStream });
  return {
    logger: pino({ level: 'info' }, pino.multistream(streams)),
    seqStream
  };
}

export const { logger, seqStream } = buildLogger(
  env.SEQ_URL,
  env.NODE_ENV === 'production',
  process.stdout,
  env.SEQ_API_KEY
);
