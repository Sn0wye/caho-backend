import type { Round, RoundStatus } from '@/schemas';

// Round persistence the timer engine needs, kept separate from the broad
// IRoundRepository so RoundTimekeeper depends only on what it uses (ISP) and the
// game-loop fakes stay untouched. The real RoundRepository implements both. See
// issue #4 / ADR-0003.
export interface IRoundTimerRepository {
  findById(id: string): Promise<Round | null>;

  // Idempotent phase claim: advance to `to` only if the Round is still in `from`
  // (one of, when an array). Returns the updated Round when this call won the
  // claim, or null when another event/instance already advanced it — so a
  // replayed expired-key event cannot double-advance. See ADR-0003.
  claimAdvance(
    id: string,
    from: RoundStatus | RoundStatus[],
    to: RoundStatus
  ): Promise<Round | null>;

  update(id: string, data: Partial<Round>): Promise<Round | null>;

  // Backstop sweep source: active Rounds (PLAYING/JUDGING) whose play- or
  // judge-deadline has already passed at `now`, used at startup to advance any
  // Round whose expiry event fired while no subscriber was listening.
  findExpiredActive(now: Date): Promise<Round[]>;
}
