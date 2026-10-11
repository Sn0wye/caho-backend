import type { RoundExpiryDriver } from './subscribeRoundExpiry';

export class FakeRoundExpiryDriver implements RoundExpiryDriver {
  readonly expiredKeys: string[] = [];
  failure?: Error;
  delay: Promise<void> = Promise.resolve();

  async onExpired(expiredKey: string): Promise<void> {
    this.expiredKeys.push(expiredKey);
    await this.delay;
    if (this.failure) throw this.failure;
  }
}
