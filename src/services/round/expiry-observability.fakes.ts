import { FakeRedisPubsub } from '@/lib/pub-sub.fakes';
import type { RoundExpiryDriver } from './subscribeRoundExpiry';

export class FakeExpiryRedisSettings {
  flags = '';
  denied = false;
  readonly changedFlags: string[] = [];

  async config(
    operation: string,
    setting: string,
    flags?: string
  ): Promise<string[] | 'OK'> {
    if (this.denied) throw new Error('CONFIG permission denied');
    if (operation === 'GET') return [setting, this.flags];
    this.changedFlags.push(flags ?? '');
    return 'OK';
  }
}

export class FakeExpiryRedis extends FakeRedisPubsub {}

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
