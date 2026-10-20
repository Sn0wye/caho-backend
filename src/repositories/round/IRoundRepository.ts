import type { Round, RoundStatus } from '@/schemas';

export interface IRoundRepository {
  create(input: Round): Promise<Round>;
  find(roomCode: string, number: number): Promise<Round | null>;
  findById(id: string): Promise<Round | null>;
  update(id: string, data: Partial<Round>): Promise<Round | null>;

  // Idempotent phase claim: advance to `to` only if the Round is still in `from`
  // (one of, when an array). Returns the updated Round when this call won the
  // claim, or null when another event/instance already advanced it — so a
  // replayed expired-key event cannot double-advance. See ADR-0003.
  claimAdvance(
    id: string,
    from: RoundStatus | RoundStatus[],
    to: RoundStatus
  ): Promise<Round | null>;

  // Backstop sweep source: active Rounds (PLAYING/JUDGING) whose play- or
  // judge-deadline has already passed at `now`, used at startup to advance any
  // Round whose expiry event fired while no subscriber was listening.
  findExpiredActive(now: Date): Promise<Round[]>;

  // Backstop sweep source: the latest Round of an IN_PROGRESS Room that ended
  // (COMPLETE/ABORTED) at or before `endedBefore` with no next Round opened, i.e.
  // a rotation that died between the claim and openRound.
  findStalledEnded(endedBefore: Date): Promise<Round[]>;
}
