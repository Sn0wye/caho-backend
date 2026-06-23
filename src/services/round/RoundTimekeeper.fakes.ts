import type { Round, RoundStatus } from '@/schemas';
import type { IRoundRotator } from './IRoundRotator';
import type { IRoundTimerRepository } from './IRoundTimerRepository';
import type { IRoundTimerStore } from './IRoundTimerStore';

// Named in-memory fakes for RoundTimekeeper unit tests, mirroring the style of
// RoomService.fakes: seed Rounds through the constructor, drive the timekeeper,
// then assert on recorded calls / mutated Rounds. See issue #4.

// Records armed/cleared keys so specs can assert a deadline was set with the
// expected TTL without a live Redis.
export class FakeRoundTimerStore implements IRoundTimerStore {
  public readonly armed = new Map<string, number>();
  public readonly cleared: string[] = [];

  async arm(key: string, ttlSeconds: number): Promise<void> {
    this.armed.set(key, ttlSeconds);
  }

  async clear(key: string): Promise<void> {
    this.cleared.push(key);
    this.armed.delete(key);
  }
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

export class FakeRoundTimerRepository implements IRoundTimerRepository {
  private rounds: Round[];

  constructor(rounds: Round[] = []) {
    this.rounds = rounds.map(round => ({ ...round }));
  }

  async findById(id: string): Promise<Round | null> {
    return this.rounds.find(round => round.id === id) ?? null;
  }

  async claimAdvance(
    id: string,
    from: RoundStatus | RoundStatus[],
    to: RoundStatus
  ): Promise<Round | null> {
    const allowed = asArray(from);
    const index = this.rounds.findIndex(round => round.id === id);
    if (index === -1) {
      return null;
    }

    const round = this.rounds[index];
    if (!allowed.includes(round.status)) {
      return null;
    }

    const advanced = { ...round, status: to, updatedAt: new Date() };
    this.rounds[index] = advanced;
    return advanced;
  }

  async update(id: string, data: Partial<Round>): Promise<Round | null> {
    const index = this.rounds.findIndex(round => round.id === id);
    if (index === -1) {
      return null;
    }
    this.rounds[index] = { ...this.rounds[index], ...data };
    return this.rounds[index];
  }

  async findExpiredActive(now: Date): Promise<Round[]> {
    return this.rounds.filter(round => {
      const active = round.status === 'PLAYING' || round.status === 'JUDGING';
      const playPassed = round.playDeadline != null && round.playDeadline <= now;
      const judgePassed =
        round.judgeDeadline != null && round.judgeDeadline <= now;
      return active && (playPassed || judgePassed);
    });
  }
}

// Records every rotation so specs can assert a Round aborted-and-rotated exactly
// once (idempotency) without the full RoomService.startNextRound machinery.
export class FakeRoundRotator implements IRoundRotator {
  public readonly rotations: Array<{ roomCode: string; currentRound: number }> =
    [];

  async startNextRound(
    roomCode: string,
    currentRound: number
  ): Promise<unknown> {
    this.rotations.push({ roomCode, currentRound });
    return { roomCode, currentRound };
  }
}
