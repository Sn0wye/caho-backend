import pino from 'pino';
import { createStream } from 'pino-seq';
import { env } from '@/env';

type SeqStream = ReturnType<typeof createStream>;

export function buildLogger(seqUrl?: string): {
  logger: pino.Logger;
  seqStream: SeqStream | null;
} {
  const consoleTransport = pino.transport({
    target: '@fastify/one-line-logger'
  });

  if (seqUrl) {
    const seqStream = createStream({ serverUrl: seqUrl });
    const logger = pino(
      { level: 'info' },
      pino.multistream([
        { stream: consoleTransport },
        // pino-seq stream is Writable-compatible; cast needed for type alignment
        { stream: seqStream as unknown as NodeJS.WritableStream }
      ])
    );
    return { logger, seqStream };
  }

  return {
    logger: pino({ level: 'info' }, consoleTransport),
    seqStream: null
  };
}

export const { logger, seqStream } = buildLogger(env.SEQ_URL);
