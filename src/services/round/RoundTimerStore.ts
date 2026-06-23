import type { Redis } from 'ioredis';
import type { IRoundTimerStore } from './IRoundTimerStore';

// ioredis-backed deadline store (ADR-0003). The value is irrelevant — only the
// key's existence and TTL matter; the expiry emits the keyspace event the
// timekeeper subscribes to. Requires `notify-keyspace-events Ex` on the server.
export class RoundTimerStore implements IRoundTimerStore {
  constructor(private readonly redis: Redis) {}

  async arm(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, '1', 'EX', ttlSeconds);
  }

  async clear(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
