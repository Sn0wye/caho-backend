import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoundReconcileSchedule } from './RoundReconcileSchedule';
import { FakeRoundReconcileDriver } from './RoundReconcileSchedule.fakes';

function buildSchedule(driver: FakeRoundReconcileDriver): {
  schedule: RoundReconcileSchedule;
  output: FakeConsoleOutput;
} {
  const output = new FakeConsoleOutput();
  const { logger } = buildLogger({ consoleOutput: output });
  return {
    schedule: new RoundReconcileSchedule(driver, logger, 30_000),
    output
  };
}

describe('RoundReconcileSchedule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sweeps every interval until stopped', async () => {
    const driver = new FakeRoundReconcileDriver();
    const { schedule } = buildSchedule(driver);

    schedule.start();
    await vi.advanceTimersByTimeAsync(90_000);
    await schedule.stop();
    await vi.advanceTimersByTimeAsync(90_000);

    expect(driver.sweeps).toBe(3);
  });

  it('joins a sweep already in flight instead of starting another', async () => {
    const driver = new FakeRoundReconcileDriver();
    let release: () => void = () => {};
    driver.hold = new Promise<void>(resolve => {
      release = resolve;
    });
    const { schedule } = buildSchedule(driver);

    const first = schedule.runNow('startup');
    schedule.request('redis_reconnect');
    release();
    await first;
    await schedule.runNow('interval');

    expect(driver.sweeps).toBe(2);
  });

  it('logs a failed requested sweep and rejects a direct one', async () => {
    const driver = new FakeRoundReconcileDriver();
    driver.failure = new Error('postgres down');
    const { schedule, output } = buildSchedule(driver);

    schedule.request('redis_reconnect');
    await vi.waitFor(() => expect(output.lines).toHaveLength(1));
    await expect(schedule.runNow('startup')).rejects.toThrow('postgres down');

    expect(JSON.parse(output.lines[0])).toMatchObject({
      event: 'round.reconcile_failed',
      trigger: 'redis_reconnect',
      level: 50
    });
  });
});
