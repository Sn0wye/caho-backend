// Thin port over the Redis timer engine (ADR-0003). A Round deadline is a Redis
// key with a TTL; its expiry emits a keyspace event the backend advances on.
// Owning this interface keeps ioredis out of RoundTimekeeper so the phase logic
// is testable with an in-memory fake. See issue #4.
export interface IRoundTimerStore {
  // Set `key` to expire in `ttlSeconds`. Overwrites any existing TTL on re-arm.
  arm(key: string, ttlSeconds: number): Promise<void>;
  // Cancel a pending deadline (e.g. the Judge reconnected within grace).
  clear(key: string): Promise<void>;
}
