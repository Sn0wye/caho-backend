import type { Logger } from 'pino';

export interface ServerResources {
  closeApp(): Promise<void>;
  closeDatabase(): Promise<void>;
  closeRedis(): Promise<unknown>;
  closeTelemetry(): Promise<void>;
  flushLogs(): Promise<unknown>;
}

export type ShutdownSignal = 'SIGTERM' | 'SIGINT';
export type CrashEvent = 'uncaughtException' | 'unhandledRejection';

/** The slice of `process` the server lifecycle touches; tests pass a fake. */
export interface ServerProcess {
  exitCode?: number | string | null;
  exit(code: number): void;
  once(signal: ShutdownSignal, listener: () => void): unknown;
  on(event: CrashEvent, listener: (reason: unknown) => void): unknown;
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

const CRASH_LOG_EVENTS: Record<CrashEvent, string> = {
  uncaughtException: 'process.uncaught_exception',
  unhandledRejection: 'process.unhandled_rejection'
};

/** Listen, and drain on SIGTERM/SIGINT or a crash. Example: await runServer({ listen, resources, log, process }). */
export async function runServer(runtime: ServerRuntime): Promise<void> {
  const stop = buildShutdown(runtime);
  installShutdownSignals(runtime.process, stop);
  installCrashHandlers(runtime, stop);
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

type Shutdown = (reason: string, failed: boolean) => Promise<void>;

function buildShutdown(runtime: ServerRuntime): Shutdown {
  let stopping = false;
  return async (reason, failed) => {
    if (stopping) return;
    stopping = true;
    // A hung dependency must not keep the container alive past its stop grace.
    const deadline = setTimeout(
      () => runtime.process.exit(1),
      runtime.shutdownDeadlineMs ?? 10000
    );
    deadline.unref();
    runtime.log.info({ event: 'server.stopping', reason }, 'Server stopping');
    const successful = await closeServerResources(
      runtime.resources,
      runtime.log
    );
    clearTimeout(deadline);
    runtime.process.exit(successful && !failed ? 0 : 1);
  };
}

function installShutdownSignals(process: ServerProcess, stop: Shutdown): void {
  process.once('SIGTERM', () => void stop('SIGTERM', false));
  process.once('SIGINT', () => void stop('SIGINT', false));
}

function installCrashHandlers(runtime: ServerRuntime, stop: Shutdown): void {
  for (const crash of ['uncaughtException', 'unhandledRejection'] as const) {
    // `on`, not `once`: a second crash mid-drain must not hit Node's default
    // handler, which exits at once and drops buffered logs and traces.
    runtime.process.on(crash, reason => {
      runtime.log.fatal(
        { event: CRASH_LOG_EVENTS[crash], err: crashError(reason) },
        'Process crashed; shutting down'
      );
      void stop(crash, true);
    });
  }
}

function crashError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  // `Promise.reject('x')` carries no stack; keep the value for diagnosis.
  return new Error(`Non-Error crash reason: ${String(reason)}`);
}
