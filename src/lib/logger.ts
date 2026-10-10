import { env } from '@/env';
import { activeTraceFields } from '@/observability/trace-context';
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

function defaultLogSettings(production: boolean): LogSettings {
  return {
    level: 'info',
    serviceName: 'caho-backend',
    serviceVersion: version,
    environment: production ? 'production' : 'development'
  };
}

function optionalSeqStream(
  seqUrl: string | undefined,
  seqApiKey: string | undefined,
  consoleLogger: pino.Logger
): SeqStream | null {
  if (!seqUrl) return null;
  return createStream({
    serverUrl: seqUrl,
    apiKey: seqApiKey,
    onError: () =>
      consoleLogger.error(
        { event: 'seq.export_failed' },
        'Seq log export failed; check endpoint and ingest credentials'
      )
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

/** Create JSON console logging and optional Seq shipping. Example: buildLogger(undefined, true). */
export function buildLogger(
  seqUrl?: string,
  production = false,
  consoleOutput: NodeJS.WritableStream = process.stdout,
  seqApiKey?: string,
  settings: LogSettings = defaultLogSettings(production)
): { logger: pino.Logger; seqStream: SeqStream | null } {
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

export const { logger, seqStream } = buildLogger(
  env.SEQ_URL,
  env.NODE_ENV === 'production',
  process.stdout,
  env.SEQ_API_KEY,
  logSettings
);
// Export failures must bypass Seq to avoid a recursive transport failure loop.
export const telemetryConsoleLogger = pino(
  loggerOptions(logSettings),
  process.stdout
);
