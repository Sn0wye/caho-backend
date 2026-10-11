import type { Round, RoundStatus } from '@/schemas';
import type { IGameRoundRepository } from '../IGameStore';
import { type InMemoryGameTables, definedOnly } from './InMemoryGameTables';

const ACTIVE_PHASES: RoundStatus[] = ['PLAYING', 'JUDGING'];

function deadlineHasExpired(deadline: Date | null, now: Date): boolean {
  return deadline != null && deadline.getTime() <= now.getTime();
}

// rounds table, with the same conditional claim and expired-active sweep as
// RoundRepository. This is the only in-memory claim: the per-service copies it
// replaced had started to drift (ADR-0003, issue #24).
export class InMemoryRoundRepository implements IGameRoundRepository {
  constructor(private readonly tables: InMemoryGameTables) {}

  /**
   * Insert a Round; its Room must exist and its number be unused there.
   *
   * @example
   * await store.rounds.create(makeRound({ roundNumber: 2 }));
   */
  async create(round: Round): Promise<Round> {
    this.tables.requireRoom(round.roomCode, `rounds(${round.id})`);
    this.assertUnique(round);
    this.tables.rounds.set(round.id, structuredClone(round));
    return structuredClone(round);
  }

  async find(roomCode: string, number: number): Promise<Round | null> {
    const round = [...this.tables.rounds.values()].find(
      candidate =>
        candidate.roomCode === roomCode && candidate.roundNumber === number
    );
    return round ? structuredClone(round) : null;
  }

  async findById(id: string): Promise<Round | null> {
    const round = this.tables.rounds.get(id);
    return round ? structuredClone(round) : null;
  }

  async update(id: string, roundPatch: Partial<Round>): Promise<Round | null> {
    const round = this.tables.rounds.get(id);
    if (!round) {
      return null;
    }
    const updated = { ...round, ...definedOnly(roundPatch) };
    this.tables.rounds.set(id, structuredClone(updated));
    return structuredClone(updated);
  }

  /**
   * UPDATE ... WHERE id = $id AND status IN ($from): a Round no longer in an
   * allowed phase matches nothing, so a replayed claim returns null.
   *
   * @example
   * const won = await store.rounds.claimAdvance('round-1', 'PLAYING', 'JUDGING');
   */
  async claimAdvance(
    id: string,
    from: RoundStatus | RoundStatus[],
    to: RoundStatus
  ): Promise<Round | null> {
    const allowed = Array.isArray(from) ? from : [from];
    const round = this.tables.rounds.get(id);
    if (!round || !allowed.includes(round.status)) {
      return null;
    }
    return await this.update(id, { status: to, updatedAt: new Date() });
  }

  /**
   * PLAYING/JUDGING Rounds with a play or Judge deadline at or before `now`.
   *
   * @example
   * const missed = await store.rounds.findExpiredActive(new Date());
   */
  async findExpiredActive(now: Date): Promise<Round[]> {
    return [...this.tables.rounds.values()]
      .filter(round => ACTIVE_PHASES.includes(round.status))
      .filter(
        round =>
          deadlineHasExpired(round.playDeadline, now) ||
          deadlineHasExpired(round.judgeDeadline, now)
      )
      .map(round => structuredClone(round));
  }

  private assertUnique(round: Round): void {
    if (this.tables.rounds.has(round.id)) {
      throw new Error(
        `Unique violation on rounds.id: "${round.id}" already exists (expected a fresh Round id)`
      );
    }
    const clash = [...this.tables.rounds.values()].some(
      existing =>
        existing.roomCode === round.roomCode &&
        existing.roundNumber === round.roundNumber
    );
    if (clash) {
      throw new Error(
        `Unique violation on rounds(room_code, round_number): Room "${round.roomCode}" already has Round ${round.roundNumber} (expected one Round per number)`
      );
    }
  }
}
