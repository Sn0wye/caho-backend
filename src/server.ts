import { env } from './env';
import {
  logSettings,
  logger,
  seqStream,
  telemetryConsoleLogger
} from './lib/logger';
import { buildTelemetry } from './lib/telemetry';
import { runServer } from './runtime';

const telemetry = buildTelemetry(
  {
    seqUrl: env.SEQ_URL,
    seqApiKey: env.SEQ_API_KEY,
    tracesEndpoint: env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    disabled: env.OTEL_SDK_DISABLED === 'true',
    sampleRatio: env.OTEL_TRACES_SAMPLER_ARG,
    serviceName: logSettings.serviceName,
    serviceVersion: logSettings.serviceVersion,
    environment: env.NODE_ENV
  },
  suppressedCount =>
    telemetryConsoleLogger.error(
      { event: 'telemetry.export_failed', suppressedCount },
      'Trace export failed; check OTLP endpoint and ingest credentials'
    )
);

async function bootServer(): Promise<void> {
  telemetry?.start();
  // Dynamic imports keep pg/ioredis unloaded until instrumentation is registered.
  const { app } = await import('./app');
  const { postgresPool } = await import('./db');
  const { redis } = await import('./db/redis');
  await runServer({
    listen: () => app.listen({ host: '0.0.0.0', port: env.PORT }),
    resources: {
      closeApp: () => app.close(),
      closeDatabase: () => postgresPool.end(),
      closeRedis: () => redis.quit(),
      closeTelemetry: async () => {
        await telemetry?.shutdown();
      },
      flushLogs: async () => {
        await seqStream?.flush();
      }
    },
    log: logger,
    process
  });
}

bootServer().catch(async err => {
  telemetryConsoleLogger.fatal(
    { event: 'server.bootstrap_failed', err },
    'Server bootstrap failed'
  );
  await telemetry?.shutdown();
  await seqStream?.flush();
  process.exit(1);
});
