import type { ServerResources } from './server-lifecycle';

export class FakeServerResources implements ServerResources {
  readonly closed: string[] = [];
  failStep?: string;

  private closeStep(step: string): Promise<void> {
    this.closed.push(step);
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
