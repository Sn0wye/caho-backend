interface FailureWindowState {
  loggedAt: number;
  suppressedCount: number;
}

/** Bound repeated outage logs without timers. Example: new FailureLogWindow(Date.now). */
export class FailureLogWindow {
  private readonly failures = new Map<string, FailureWindowState>();

  constructor(
    private readonly now: () => number,
    private readonly intervalMs = 30000
  ) {}

  /** Return repeat count when a log is due, null otherwise. Example: failures.allow('redis'). */
  public allow(key: string): number | null {
    const previous = this.failures.get(key);
    const timestamp = this.now();
    if (previous && timestamp - previous.loggedAt < this.intervalMs) {
      previous.suppressedCount++;
      return null;
    }
    this.failures.set(key, { loggedAt: timestamp, suppressedCount: 0 });
    return previous?.suppressedCount ?? 0;
  }

  /** Reset on recovery and return the unreported repeat count. Example: failures.recover('redis'). */
  public recover(key: string): number | null {
    const previous = this.failures.get(key);
    if (!previous) return null;
    this.failures.delete(key);
    return previous.suppressedCount;
  }
}
