import type { IRoundPlayedCardsRepository } from '@/repositories/round-played-cards';
import type { Round } from '@/schemas';
import type { IRoundEventPublisher } from './IRoundEventPublisher';
import type { IRoundRotator } from './IRoundRotator';
import type { IRoundTimerRepository } from './IRoundTimerRepository';
import type { IRoundTimerStore } from './IRoundTimerStore';
import { judgeKey, parseDeadlineKey, playKey } from './deadlineKeys';

export type RoundTimerConfig = {
  // Play-phase window before AFK Players are skipped (ADR-0003 default: 60s).
  playWindowSeconds: number;
  // Grace a dropped Judge gets to reconnect before the Round aborts (ADR-0002).
  judgeGraceSeconds: number;
};

export const DEFAULT_ROUND_TIMER_CONFIG: RoundTimerConfig = {
  playWindowSeconds: 60,
  judgeGraceSeconds: 30
};

// Drives Round deadlines off Redis key-expiry instead of an in-process timer, so
// timers survive restarts and the multi-instance model holds (ADR-0001/0003).
// Arming a deadline both sets a TTL'd Redis key and stores the deadline in
// Postgres; an expired-key event (or the startup sweep) routes here to advance
// the Round through an idempotent phase claim. See issue #4.
export class RoundTimekeeper {
  constructor(
    private readonly store: IRoundTimerStore,
    private readonly rounds: IRoundTimerRepository,
    private readonly playedCards: IRoundPlayedCardsRepository,
    private readonly rotator: IRoundRotator,
    private readonly publisher: IRoundEventPublisher,
    private readonly config: RoundTimerConfig = DEFAULT_ROUND_TIMER_CONFIG
  ) {}

  // Start a Round's play window: arm the Redis TTL key and persist the deadline
  // as a Postgres backstop so a missed expiry event can still be reconciled.
  public async armPlayDeadline(roundId: string): Promise<void> {
    const ttl = this.config.playWindowSeconds;
    await this.store.arm(playKey(roundId), ttl);
    await this.rounds.update(roundId, {
      status: 'PLAYING',
      playDeadline: new Date(Date.now() + ttl * 1000)
    });
  }

  // Play window elapsed: Players who didn't submit are simply skipped. If anyone
  // played, advance to JUDGING with what was submitted. The conditional claim
  // (PLAYING -> JUDGING) makes a replayed expiry event a no-op.
  public async onPlayExpired(roundId: string): Promise<void> {
    const round = await this.rounds.findById(roundId);
    if (!round || round.status !== 'PLAYING') {
      return;
    }

    const plays = await this.playedCards.findByRoomCodeAndRoundNumber(
      round.roomCode,
      round.roundNumber
    );

    if (plays.length === 0) {
      await this.abortAndRotate(round);
      return;
    }

    // Gate the broadcast on the claim: only the event that actually won the
    // PLAYING->JUDGING transition tells the Room it's time to judge, so a
    // replayed expiry event can't re-broadcast.
    const claimed = await this.rounds.claimAdvance(roundId, 'PLAYING', 'JUDGING');
    if (claimed) {
      await this.publisher.publish(round.roomCode, {
        event: 'room.time-to-judge',
        payload: { roundPlayedCards: plays }
      });
    }
  }

  // A Judge dropped (ADR-0002): hold the Round awaiting reconnect and arm the
  // grace key. Phase is left untouched — only expiry (onJudgeExpired) or an
  // explicit leave ends the hold. The deadline is mirrored to Postgres as a
  // backstop for the startup sweep.
  public async armJudgeGrace(roundId: string): Promise<void> {
    const ttl = this.config.judgeGraceSeconds;
    await this.store.arm(judgeKey(roundId), ttl);
    await this.rounds.update(roundId, {
      judgeDeadline: new Date(Date.now() + ttl * 1000)
    });
  }

  // Judge grace lapsed (or an explicit Judge leave routes here): abort the Round
  // and rotate the Judge. Idempotent via the claim inside abortAndRotate.
  public async onJudgeExpired(roundId: string): Promise<void> {
    const round = await this.rounds.findById(roundId);
    if (!round) {
      return;
    }

    await this.abortAndRotate(round);
  }

  // Entry point for a Redis expired-key event: decode the key and route it.
  // Keys that aren't ours (the keyspace is shared) are ignored. See ADR-0003.
  public async onExpired(expiredKey: string): Promise<void> {
    const parsed = parseDeadlineKey(expiredKey);
    if (!parsed) {
      return;
    }

    if (parsed.kind === 'play') {
      await this.onPlayExpired(parsed.roundId);
      return;
    }

    await this.onJudgeExpired(parsed.roundId);
  }

  // Startup backstop: advance every Round whose deadline already passed while no
  // subscriber was listening (a missed expiry event). Routing mirrors the live
  // event path; the idempotent claim makes it safe to run alongside a subscriber.
  public async reconcile(): Promise<void> {
    const stale = await this.rounds.findExpiredActive(new Date());
    for (const round of stale) {
      await this.advanceExpired(round);
    }
  }

  // Route a Round known to be past a deadline to the matching transition. A
  // lapsed judge-grace takes precedence over the play deadline because the Round
  // was being held for a dropped Judge (ADR-0002).
  private async advanceExpired(round: Round): Promise<void> {
    const now = Date.now();
    if (round.judgeDeadline != null && round.judgeDeadline.getTime() <= now) {
      await this.onJudgeExpired(round.id);
      return;
    }
    await this.onPlayExpired(round.id);
  }

  // Abort an active Round and rotate the Judge by starting the next one. The
  // conditional claim is the idempotency guard: only the caller that flips the
  // Round to ABORTED rotates, so a duplicate/replayed event cannot double-rotate.
  private async abortAndRotate(round: Round): Promise<void> {
    const claimed = await this.rounds.claimAdvance(
      round.id,
      ['PLAYING', 'JUDGING'],
      'ABORTED'
    );
    if (!claimed) {
      return;
    }

    const next = await this.rotator.startNextRound(
      round.roomCode,
      round.roundNumber
    );

    await this.publisher.publish(round.roomCode, {
      event: 'room.round-start',
      payload: { roundNumber: next.roundNumber, blackCard: next.blackCard }
    });
  }
}
