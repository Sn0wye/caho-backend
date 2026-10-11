import type { IRoundTimerStore } from './IRoundTimerStore';

// Records armed/cleared deadline keys so specs can assert a deadline was set
// with the expected TTL, and expire one on demand, without a live Redis.
export class FakeRoundTimerStore implements IRoundTimerStore {
  public readonly armed = new Map<string, number>();
  public readonly cleared: string[] = [];
  // Runs inside clear(), before it returns, so a spec can land a concurrent
  // event in the gap between cancelling a deadline and the caller's next step.
  public beforeClear?: (key: string) => Promise<void>;

  async arm(key: string, ttlSeconds: number): Promise<void> {
    this.armed.set(key, ttlSeconds);
  }

  async clear(key: string): Promise<void> {
    this.cleared.push(key);
    this.armed.delete(key);
    await this.beforeClear?.(key);
  }

  /**
   * Let an armed key lapse, as Redis would at its TTL, and hand the key to the
   * expiry handler. Throws if the key was never armed (or already cleared).
   *
   * @example
   * await timers.expire(playKey(roundId), key => rounds.onExpired(key));
   */
  async expire(key: string, onExpired: (key: string) => Promise<void>): Promise<void> {
    if (!this.armed.delete(key)) {
      throw new Error(`Cannot expire "${key}": not armed (armed: ${[...this.armed.keys()].join(', ') || 'none'})`);
    }
    await onExpired(key);
  }
}
