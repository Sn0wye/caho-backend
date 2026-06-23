import type { Round, RoundPlayedCard } from '@/schemas';

// The slice of RoundTimekeeper that RoundFlow drives (ISP): arm the next Round's
// play deadline after a Judge pick, and advance to judging the moment every active
// Player has played. advanceToJudging is the single guarded transition shared with
// the timer-expiry path, so the all-played and deadline-lapsed routes can't
// double-prompt the Judge. RoundTimekeeper structurally satisfies this. ADR-0004.
export interface IRoundClock {
  armPlayDeadline(roundId: string): Promise<void>;
  advanceToJudging(round: Round, plays: RoundPlayedCard[]): Promise<boolean>;
}
