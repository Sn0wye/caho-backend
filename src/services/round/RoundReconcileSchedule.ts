import { traceBackground } from '@/lib/tracing';
import type { Logger } from 'pino';
import type { RoundLifecycle } from './RoundLifecycle';

export const ROUND_RECONCILE_INTERVAL_MS = 30_000;

export type RoundReconcileDriver = Pick<RoundLifecycle, 'reconcile'>;
export type RoundReconcileTrigger = 'startup' | 'interval' | 'redis_reconnect';

/**
 * Runs the Round backstop sweep (RoundLifecycle.reconcile) at startup, every
 * 30s and whenever the expiry subscriber reconnects. Expired-key events are
 * fire-and-forget: one missed while the subscriber was down, or a rotation that
 * died mid-way, used to leave the Room stuck until the next deploy.
 *
 * @example
 * const schedule = new RoundReconcileSchedule(rounds, logger);
 * await schedule.runNow('startup');
 * schedule.start();
 */
export class RoundReconcileSchedule {
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly rounds: RoundReconcileDriver,
    private readonly log: Logger,
    private readonly intervalMs: number = ROUND_RECONCILE_INTERVAL_MS
  ) {}

  // Sweep every `intervalMs` until stop(). unref: the timer alone must not
  // keep the process alive past shutdown.
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.request('interval'), this.intervalMs);
    this.timer.unref();
  }

  // Single-flight: a trigger while a sweep runs joins it rather than stacking a
  // second sweep over the same Rounds. Rejects when the sweep fails.
  runNow(trigger: RoundReconcileTrigger): Promise<void> {
    if (this.running) return this.running;
    const sweep = traceBackground('round.reconcile', { trigger }, () =>
      this.rounds.reconcile()
    );
    this.running = sweep.finally(() => {
      this.running = null;
    });
    return this.running;
  }

  // Fire-and-forget sweep for timers and Redis callbacks; failures are logged.
  request(trigger: RoundReconcileTrigger): void {
    this.runNow(trigger).catch((err: unknown) => {
      this.log.error(
        { event: 'round.reconcile_failed', trigger, err },
        'Round reconciliation sweep failed'
      );
    });
  }

  // Stop the interval and wait out a sweep in flight.
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }
}
