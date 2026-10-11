import { describe, expect, it } from 'vitest';
import { FailureLogWindow } from './failure-log-window';

class FakeFailureClock {
  milliseconds = 0;
  readonly now = (): number => this.milliseconds;
}

describe('outage log window', () => {
  it('logs immediately, counts repeats, and emits a summary every thirty seconds', () => {
    const clock = new FakeFailureClock();
    const failures = new FailureLogWindow(clock.now);
    expect(failures.allow('redis')).toBe(0);
    for (let index = 0; index < 100; index++)
      expect(failures.allow('redis')).toBeNull();
    clock.milliseconds = 29999;
    expect(failures.allow('redis')).toBeNull();
    clock.milliseconds = 30000;
    expect(failures.allow('redis')).toBe(101);
    expect(failures.allow('redis')).toBeNull();
  });

  it('resets on recovery so a new outage is visible immediately', () => {
    const clock = new FakeFailureClock();
    const failures = new FailureLogWindow(clock.now);
    expect(failures.recover('redis')).toBeNull();
    failures.allow('redis');
    failures.allow('redis');
    expect(failures.recover('redis')).toBe(1);
    expect(failures.recover('redis')).toBeNull();
    expect(failures.allow('redis')).toBe(0);
  });

  it('keeps independent dependencies visible during the same outage', () => {
    const clock = new FakeFailureClock();
    const failures = new FailureLogWindow(clock.now);
    expect(failures.allow('postgres')).toBe(0);
    expect(failures.allow('redis')).toBe(0);
    expect(failures.allow('postgres')).toBeNull();
    expect(failures.recover('redis')).toBe(0);
    expect(failures.allow('postgres')).toBeNull();
  });
});
