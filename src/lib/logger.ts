import { env } from '@/env';
import { FailureLogWindow } from '@/lib/failure-log-window';
import { activeTraceFields } from '@/lib/tracing';
import pino from 'pino';
import { createStream } from 'pino-seq';
import { version } from '../../package.json';

type SeqStream = ReturnType<typeof createStream>;

export interface LogSettings {
  level: pino.LevelWithSilent;
  serviceName: string;
  serviceVersion: string;
  environment: string;
}

const SECRET_FIELDS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'authorizationCode',
  'codeVerifier',
  'state',
  'sessionId',
  'cookie',
  'authorization',
  'apiKey',
  'seqApiKey',
  'email',
  'cardIds',
  'cards',
  'payload'
];

function serializeLogError(error: Error): {
  type: string;
  message: string;
  stack: string;
} {
  const serialized = pino.stdSerializers.err(error);
  // Driver errors may carry query parameters and user values in enumerable fields.
  return {
    type: serialized.type,
    message: serialized.message,
    stack: serialized.stack
  };
}

const logRedaction = {
  paths: [
    'req.headers',
    'req.body',
    'req.url',
    // Fastify WebSocket's unmatched-upgrade logger uses a raw path field.
    'path',
    'res.headers',
    ...SECRET_FIELDS.flatMap(field => [field, `*.${field}`, `*.*.${field}`])
  ],
  censor: '[REDACTED]'
};

function loggerOptions(settings: LogSettings): pino.LoggerOptions {
  return {
    level: settings.level,
    base: {
      service: settings.serviceName,
      serviceVersion: settings.serviceVersion,
      environment: settings.environment
    },
    mixin: activeTraceFields,
    serializers: { err: serializeLogError, error: serializeLogError },
    // Avoid logging request/response objects and free-form application payloads.
    redact: logRedaction
  };
}

const DEFAULT_LOG_SETTINGS: LogSettings = {
  level: 'info',
  serviceName: 'caho-backend',
  serviceVersion: version,
  environment: 'development'
};

function optionalSeqStream(
  seqUrl: string | undefined,
  seqApiKey: string | undefined,
  consoleLogger: pino.Logger
): SeqStream | null {
  if (!seqUrl) return null;
  const failures = new FailureLogWindow(Date.now);
  return createStream({
    serverUrl: seqUrl,
    apiKey: seqApiKey,
    onError: () => {
      const suppressedCount = failures.allow('seq');
      if (suppressedCount === null) return;
      consoleLogger.error(
        { event: 'seq.export_failed', suppressedCount },
        'Seq log export failed; check endpoint and ingest credentials'
      );
    }
  });
}

function loggerStreams(
  consoleOutput: NodeJS.WritableStream,
  seqStream: SeqStream | null,
  level: pino.LevelWithSilent
): pino.StreamEntry[] {
  const streamLevel = level === 'silent' ? 'fatal' : level;
  const streams: pino.StreamEntry[] = [
    { level: streamLevel, stream: consoleOutput }
  ];
  // pino-seq stream is Writable-compatible; cast needed for type alignment
  if (seqStream)
    streams.push({
      level: streamLevel,
      stream: seqStream as unknown as NodeJS.WritableStream
    });
  return streams;
}

export interface LoggerTargets {
  consoleOutput?: NodeJS.WritableStream;
  seqUrl?: string;
  seqApiKey?: string;
  settings?: LogSettings;
}

/** Create JSON console logging and optional Seq shipping. Example: buildLogger({ consoleOutput: output }). */
export function buildLogger({
  consoleOutput = process.stdout,
  seqUrl,
  seqApiKey,
  settings = DEFAULT_LOG_SETTINGS
}: LoggerTargets = {}): { logger: pino.Logger; seqStream: SeqStream | null } {
  const options = loggerOptions(settings);
  const seqStream = optionalSeqStream(
    seqUrl,
    seqApiKey,
    pino(options, consoleOutput)
  );
  const streams = loggerStreams(consoleOutput, seqStream, settings.level);
  return { logger: pino(options, pino.multistream(streams)), seqStream };
}

export const logSettings: LogSettings = {
  level: env.LOG_LEVEL,
  serviceName: env.OTEL_SERVICE_NAME,
  serviceVersion: version,
  environment: env.NODE_ENV
};

export const { logger, seqStream } = buildLogger({
  seqUrl: env.SEQ_URL,
  seqApiKey: env.SEQ_API_KEY,
  settings: logSettings
});
// Export failures must bypass Seq to avoid a recursive transport failure loop.
export const telemetryConsoleLogger = pino(
  loggerOptions(logSettings),
  process.stdout
);
