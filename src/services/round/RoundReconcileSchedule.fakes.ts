import type { RoundReconcileDriver } from './RoundReconcileSchedule';

// Counts sweeps; `hold` keeps each one in flight until the test releases it.
export class FakeRoundReconcileDriver implements RoundReconcileDriver {
  sweeps = 0;
  failure?: Error;
  hold: Promise<void> = Promise.resolve();

  async reconcile(): Promise<void> {
    this.sweeps += 1;
    await this.hold;
    if (this.failure) throw this.failure;
  }
}
