import type { Logger } from 'pino';

export interface ServerResources {
  closeApp(): Promise<void>;
  closeDatabase(): Promise<void>;
  closeRedis(): Promise<unknown>;
  closeTelemetry(): Promise<void>;
  flushLogs(): Promise<unknown>;
}

/** The slice of `process` the server lifecycle touches; tests pass a fake. */
export interface ServerProcess {
  exitCode?: number | string | null;
  exit(code: number): void;
  once(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

export interface ServerRuntime {
  listen(): Promise<string>;
  resources: ServerResources;
  log: Logger;
  process: ServerProcess;
  shutdownDeadlineMs?: number;
}

const SHUTDOWN_STEPS = [
  'closeApp',
  'closeDatabase',
  'closeRedis',
  'closeTelemetry',
  'flushLogs'
] as const;

/** Listen, and drain on SIGTERM/SIGINT. Example: await runServer({ listen, resources, log, process }). */
export async function runServer(runtime: ServerRuntime): Promise<void> {
  installShutdownSignals(runtime);
  try {
    const url = await runtime.listen();
    runtime.log.info({ event: 'server.started', url }, 'Server listening');
  } catch (err) {
    runtime.log.fatal(
      { event: 'server.startup_failed', err },
      'Server startup failed'
    );
    await closeServerResources(runtime.resources, runtime.log);
    runtime.process.exitCode = 1;
  }
}

/** Drain app, dependencies and telemetry before exit. Example: await closeServerResources(resources, logger). */
export async function closeServerResources(
  resources: ServerResources,
  log: Logger
): Promise<boolean> {
  let successful = true;
  for (const step of SHUTDOWN_STEPS) {
    try {
      await resources[step]();
    } catch (err) {
      successful = false;
      log.error(
        { event: 'server.shutdown_failed', step, err },
        'Server resource shutdown failed'
      );
    }
  }
  return successful;
}

function installShutdownSignals(runtime: ServerRuntime): void {
  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    // A hung dependency must not keep the container alive past its stop grace.
    const deadline = setTimeout(
      () => runtime.process.exit(1),
      runtime.shutdownDeadlineMs ?? 10000
    );
    deadline.unref();
    runtime.log.info({ event: 'server.stopping', signal }, 'Server stopping');
    const successful = await closeServerResources(
      runtime.resources,
      runtime.log
    );
    clearTimeout(deadline);
    runtime.process.exit(successful ? 0 : 1);
  };
  runtime.process.once('SIGTERM', () => void stop('SIGTERM'));
  runtime.process.once('SIGINT', () => void stop('SIGINT'));
}
