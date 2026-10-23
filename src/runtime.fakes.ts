import type {
  CrashEvent,
  ServerProcess,
  ServerResources,
  ShutdownSignal
} from './runtime';

export class FakeServerResources implements ServerResources {
  readonly closed: string[] = [];
  failStep?: string;
  hangStep?: string;

  private closeStep(step: string): Promise<void> {
    this.closed.push(step);
    if (this.hangStep === step) return new Promise(() => {});
    if (this.failStep === step)
      return Promise.reject(new Error(`${step} failed`));
    return Promise.resolve();
  }

  closeApp(): Promise<void> {
    return this.closeStep('app');
  }
  closeDatabase(): Promise<void> {
    return this.closeStep('database');
  }
  closeRedis(): Promise<void> {
    return this.closeStep('redis');
  }
  closeTelemetry(): Promise<void> {
    return this.closeStep('telemetry');
  }
  flushLogs(): Promise<void> {
    return this.closeStep('logs');
  }
}

export class FakeServerProcess implements ServerProcess {
  exitCode?: number | string | null;
  readonly exits: number[] = [];
  private readonly listeners = new Map<string, () => void>();
  private readonly crashListeners = new Map<
    CrashEvent,
    (reason: unknown) => void
  >();

  exit(code: number): void {
    this.exits.push(code);
  }

  once(signal: ShutdownSignal, listener: () => void): this {
    this.listeners.set(signal, listener);
    return this;
  }

  on(event: CrashEvent, listener: (reason: unknown) => void): this {
    this.crashListeners.set(event, listener);
    return this;
  }

  /** Raise a crash like Node would; `on` listeners fire on every crash. */
  crash(event: CrashEvent, reason: unknown): void {
    this.crashListeners.get(event)?.(reason);
  }

  /** Deliver a signal like the OS would; `once` listeners fire at most once. */
  signal(signal: ShutdownSignal): void {
    const listener = this.listeners.get(signal);
    this.listeners.delete(signal);
    listener?.();
  }
}
