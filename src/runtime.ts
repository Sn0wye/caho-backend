import { app } from './app';
import { postgresPool } from './db';
import { redis } from './db/redis';
import { env } from './env';
import { logger, seqStream } from './lib/logger';
import {
  type ServerResources,
  closeServerResources
} from './observability/server-lifecycle';

/** Run the app after OTEL starts, and drain on signals. Example: await runServer(() => sdk.shutdown()). */
export async function runServer(
  closeTelemetry: () => Promise<void>
): Promise<void> {
  const resources = serverResources(closeTelemetry);
  installShutdownSignals(resources);
  try {
    const url = await app.listen({ host: '0.0.0.0', port: env.PORT });
    logger.info({ event: 'server.started', url }, 'Server listening');
  } catch (err) {
    logger.fatal(
      { event: 'server.startup_failed', err },
      'Server startup failed'
    );
    await closeServerResources(resources, logger);
    process.exitCode = 1;
  }
}

function serverResources(closeTelemetry: () => Promise<void>): ServerResources {
  return {
    closeApp: () => app.close(),
    closeDatabase: () => postgresPool.end(),
    closeRedis: () => redis.quit(),
    closeTelemetry,
    flushLogs: async () => {
      await seqStream?.flush();
    }
  };
}

function installShutdownSignals(resources: ServerResources): void {
  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    logger.info({ event: 'server.stopping', signal }, 'Server stopping');
    const successful = await closeServerResources(resources, logger);
    clearTimeout(deadline);
    process.exit(successful ? 0 : 1);
  };
  process.once('SIGTERM', () => {
    void stop('SIGTERM');
  });
  process.once('SIGINT', () => {
    void stop('SIGINT');
  });
}
