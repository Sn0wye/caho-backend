import type { IRoundRotator, RoundRotation } from './IRoundRotator';
import type { IRoundTimerStore } from './IRoundTimerStore';

// Named fakes for the RoundTimekeeper ports that aren't the game store: the
// Redis timer and the rotation. Rounds and Played Cards come from the shared
// InMemoryGameStore and events from FakeGameEventPublisher. See issues #4, #24.

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

// Records every rotation so specs can assert a Round aborted-and-rotated exactly
// once (idempotency) without the full RoomService.startNextRound machinery, and
// returns a stub next Round so the round-start broadcast has a payload.
export class FakeRoundRotator implements IRoundRotator {
  public readonly rotations: Array<{ roomCode: string; currentRound: number }> =
    [];

  async startNextRound(
    roomCode: string,
    currentRound: number
  ): Promise<RoundRotation> {
    this.rotations.push({ roomCode, currentRound });
    return {
      id: `fake-round-${currentRound + 1}`,
      roundNumber: currentRound + 1,
      judgeId: 'fake-next-judge',
      blackCard: { text: 'next black card', pick: 1, packId: 'fake-pack' }
    };
  }
}
