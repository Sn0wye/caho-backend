import type { ServerProcess, ServerResources } from './runtime';

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

  exit(code: number): void {
    this.exits.push(code);
  }

  once(signal: 'SIGTERM' | 'SIGINT', listener: () => void): this {
    this.listeners.set(signal, listener);
    return this;
  }

  /** Deliver a signal like the OS would; `once` listeners fire at most once. */
  signal(signal: 'SIGTERM' | 'SIGINT'): void {
    const listener = this.listeners.get(signal);
    this.listeners.delete(signal);
    listener?.();
  }
}
