import type { Logger } from 'pino';

export interface ServerResources {
  closeApp(): Promise<void>;
  closeDatabase(): Promise<void>;
  closeRedis(): Promise<unknown>;
  closeTelemetry(): Promise<void>;
  flushLogs(): Promise<unknown>;
}

/** Drain app, dependencies and telemetry before exit. Example: await closeServerResources(resources, logger). */
export async function closeServerResources(
  resources: ServerResources,
  log: Logger
): Promise<boolean> {
  const steps = [
    'closeApp',
    'closeDatabase',
    'closeRedis',
    'closeTelemetry',
    'flushLogs'
  ] as const;
  let successful = true;
  for (const step of steps) {
    try {
      await resources[step]();
    } catch (err) {
      successful = false;
      logShutdownFailure(log, step, err);
    }
  }
  return successful;
}

function logShutdownFailure(log: Logger, step: string, err: unknown): void {
  log.error(
    { event: 'server.shutdown_failed', step, err },
    'Server resource shutdown failed'
  );
}
