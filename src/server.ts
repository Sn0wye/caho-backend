import { env } from './env';
import { logSettings, seqStream, telemetryConsoleLogger } from './lib/logger';
import { buildTelemetry } from './observability/telemetry';

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
  // Dynamic import keeps pg/ioredis unloaded until instrumentation is registered.
  const { runServer } = await import('./runtime');
  await runServer(async () => {
    await telemetry?.shutdown();
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
