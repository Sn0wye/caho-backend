import type { Round, RoundStatus } from '@/schemas';
import type { IGameRoundRepository } from '../IGameStore';
import {
  type InMemoryGameTables,
  cloneRow,
  definedOnly
} from './InMemoryGameTables';

const ACTIVE_PHASES: RoundStatus[] = ['PLAYING', 'JUDGING'];

function passed(deadline: Date | null, now: Date): boolean {
  return deadline != null && deadline.getTime() <= now.getTime();
}

// rounds table, with the same conditional claim and expired-active sweep as
// RoundRepository. This is the only in-memory claim: the per-service copies it
// replaced had started to drift (ADR-0003, issue #24).
export class InMemoryRoundRepository implements IGameRoundRepository {
  constructor(private readonly tables: InMemoryGameTables) {}

  async create(input: Round): Promise<Round> {
    this.tables.requireRoom(input.roomCode, `rounds(${input.id})`);
    this.assertUnique(input);
    this.tables.rounds.set(input.id, cloneRow(input));
    return cloneRow(input);
  }

  async find(roomCode: string, number: number): Promise<Round | null> {
    const round = [...this.tables.rounds.values()].find(
      candidate =>
        candidate.roomCode === roomCode && candidate.roundNumber === number
    );
    return round ? cloneRow(round) : null;
  }

  async findById(id: string): Promise<Round | null> {
    const round = this.tables.rounds.get(id);
    return round ? cloneRow(round) : null;
  }

  async update(id: string, data: Partial<Round>): Promise<Round | null> {
    const round = this.tables.rounds.get(id);
    if (!round) {
      return null;
    }
    const updated = { ...round, ...definedOnly(data) };
    this.tables.rounds.set(id, cloneRow(updated));
    return cloneRow(updated);
  }

  // UPDATE ... WHERE id = $id AND status IN ($from): a Round no longer in an
  // allowed phase matches nothing, so a replayed claim returns null.
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

  async findExpiredActive(now: Date): Promise<Round[]> {
    return [...this.tables.rounds.values()]
      .filter(round => ACTIVE_PHASES.includes(round.status))
      .filter(
        round =>
          passed(round.playDeadline, now) || passed(round.judgeDeadline, now)
      )
      .map(cloneRow);
  }

  private assertUnique(input: Round): void {
    if (this.tables.rounds.has(input.id)) {
      throw new Error(
        `Unique violation on rounds.id: "${input.id}" already exists (expected a fresh Round id)`
      );
    }
    const clash = [...this.tables.rounds.values()].some(
      round =>
        round.roomCode === input.roomCode &&
        round.roundNumber === input.roundNumber
    );
    if (clash) {
      throw new Error(
        `Unique violation on rounds(room_code, round_number): Room "${input.roomCode}" already has Round ${input.roundNumber} (expected one Round per number)`
      );
    }
  }
}
