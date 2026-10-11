import type { IRoundRepository } from '@/repositories/round/IRoundRepository';
import type { Round } from '@/schemas';
import type { Logger } from 'pino';
import type { IRoundTimerStore } from './IRoundTimerStore';
import { graceKey, judgeKey, playKey } from './deadlineKeys';

export type RoundTimerConfig = {
  // Play-phase window before AFK Players are skipped (ADR-0003 default: 60s).
  playWindowSeconds: number;
  // Grace a dropped Judge gets to reconnect before the Round aborts (ADR-0002).
  judgeGraceSeconds: number;
  // How long a connected Judge has to pick once judging opens. Without it an
  // AFK (but still connected) Judge stalled the Room forever.
  judgeWindowSeconds: number;
};

export const DEFAULT_ROUND_TIMER_CONFIG: RoundTimerConfig = {
  playWindowSeconds: 60,
  judgeGraceSeconds: 30,
  judgeWindowSeconds: 90
};

/**
 * The Date `seconds` from now, for mirroring a Redis TTL to a Postgres deadline.
 *
 * @example
 * secondsFromNow(60); // the play deadline of a Round opened now
 */
const secondsFromNow = (seconds: number): Date =>
  new Date(Date.now() + seconds * 1000);

/**
 * The sooner of a stored deadline (if any) and a new one, so mirroring a second
 * deadline into one column never pushes the sweep past the first.
 *
 * @example
 * earliest(round.judgeDeadline, secondsFromNow(30));
 */
const earliest = (current: Date | null, next: Date): Date =>
  current && current < next ? current : next;

/**
 * A Round's three deadlines — play, judging window and dropped-Judge grace —
 * each its own Redis TTL key (ADR-0003) mirrored to the Round's Postgres
 * deadline columns for the startup sweep. Built and driven by RoundLifecycle,
 * which decides when each applies (#25).
 *
 * @example
 * const clocks = new RoundDeadlines(timerStore, store.rounds, DEFAULT_ROUND_TIMER_CONFIG);
 * await clocks.armGrace(round);
 */
export class RoundDeadlines {
  constructor(
    private readonly timers: IRoundTimerStore,
    private readonly rounds: IRoundRepository,
    private readonly config: RoundTimerConfig,
    private readonly log?: Logger
  ) {}

  // The play deadline of a Round opened now, stored on its row at creation.
  public playDeadline(): Date {
    return secondsFromNow(this.config.playWindowSeconds);
  }

  public async armPlay(roundId: string): Promise<void> {
    await this.timers.arm(playKey(roundId), this.config.playWindowSeconds);
  }

  public async armJudgingWindow(roundId: string): Promise<void> {
    const ttl = this.config.judgeWindowSeconds;
    await this.timers.arm(judgeKey(roundId), ttl);
    await this.rounds.update(roundId, { judgeDeadline: secondsFromNow(ttl) });
  }

  // Own key, so judging opening can't overwrite it. The Postgres judgeDeadline
  // holds whichever Judge deadline fires first (grace or judging window), so the
  // startup sweep never waits past either; no third column (ADR-0004).
  public async armGrace(round: Round): Promise<void> {
    const ttl = this.config.judgeGraceSeconds;
    await this.timers.arm(graceKey(round.id), ttl);
    await this.rounds.update(round.id, {
      judgeDeadline: earliest(round.judgeDeadline, secondsFromNow(ttl))
    });
    this.log?.info(
      { event: 'round.judge_grace_armed', roundId: round.id, ttlSeconds: ttl },
      'Judge reconnect grace armed'
    );
  }

  // The Judge reconnected (ADR-0002: "held awaiting reconnect"): cancel the
  // grace so the Round isn't aborted under them; while judging, give them a
  // full judging window again.
  public async releaseGrace(round: Round): Promise<void> {
    await this.timers.clear(graceKey(round.id));
    this.log?.info(
      { event: 'round.judge_returned', roundId: round.id, phase: round.status },
      'Judge returned'
    );
    if (round.status === 'JUDGING') {
      await this.armJudgingWindow(round.id);
      return;
    }
    await this.rounds.update(round.id, { judgeDeadline: null });
  }
}
