import type { Round, RoundPlayedCard } from '@/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeRoundPlayedCardsRepository } from '../room/RoomService.fakes';
import {
  FakeRoundRotator,
  FakeRoundTimerRepository,
  FakeRoundTimerStore
} from './RoundTimekeeper.fakes';
import { RoundTimekeeper } from './RoundTimekeeper';
import { judgeKey, parseDeadlineKey, playKey } from './deadlineKeys';

const ROOM_CODE = 'ABC123';
const ROUND_ID = 'round-1';

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: ROUND_ID,
    roomCode: ROOM_CODE,
    roundNumber: 1,
    blackCardId: 'black-1',
    judgeId: 'player-judge',
    roundWinnerId: null,
    status: 'PLAYING',
    playDeadline: null,
    judgeDeadline: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function makePlayedCard(playerId: string): RoundPlayedCard {
  return {
    id: `played-${playerId}`,
    roundId: ROUND_ID,
    player: {
      id: playerId,
      name: playerId,
      email: null,
      username: playerId,
      password: 'x',
      avatarUrl: null
    },
    whiteCards: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

type Fakes = {
  store: FakeRoundTimerStore;
  rounds: FakeRoundTimerRepository;
  playedCards: FakeRoundPlayedCardsRepository;
  rotator: FakeRoundRotator;
};

function buildTimekeeper(args: {
  rounds: Round[];
  playedCards?: RoundPlayedCard[];
}): { timekeeper: RoundTimekeeper; fakes: Fakes } {
  const fakes: Fakes = {
    store: new FakeRoundTimerStore(),
    rounds: new FakeRoundTimerRepository(args.rounds),
    playedCards: new FakeRoundPlayedCardsRepository(args.playedCards ?? []),
    rotator: new FakeRoundRotator()
  };

  const timekeeper = new RoundTimekeeper(
    fakes.store,
    fakes.rounds,
    fakes.playedCards,
    fakes.rotator,
    { playWindowSeconds: 60, judgeGraceSeconds: 30 }
  );

  return { timekeeper, fakes };
}

describe('RoundTimekeeper.armPlayDeadline', () => {
  it('arms the Redis play key with the configured TTL', async () => {
    const { timekeeper, fakes } = buildTimekeeper({ rounds: [makeRound()] });

    await timekeeper.armPlayDeadline(ROUND_ID);

    expect(fakes.store.armed.get(playKey(ROUND_ID))).toBe(60);
  });

  it('persists the play deadline on the Round as a Postgres backstop', async () => {
    const { timekeeper, fakes } = buildTimekeeper({ rounds: [makeRound()] });

    const before = Date.now();
    await timekeeper.armPlayDeadline(ROUND_ID);

    const round = await fakes.rounds.findById(ROUND_ID);
    expect(round?.status).toBe('PLAYING');
    expect(round?.playDeadline?.getTime()).toBeGreaterThanOrEqual(before + 60_000);
  });
});

describe('RoundTimekeeper.onPlayExpired', () => {
  it('moves to JUDGING when at least one Player played, skipping the rest', async () => {
    const { timekeeper, fakes } = buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })],
      playedCards: [makePlayedCard('player-a')]
    });

    await timekeeper.onPlayExpired(ROUND_ID);

    const round = await fakes.rounds.findById(ROUND_ID);
    expect(round?.status).toBe('JUDGING');
    // Judging proceeds with what was submitted; no abort/rotation.
    expect(fakes.rotator.rotations).toHaveLength(0);
  });

  it('aborts the Round and rotates the Judge when nobody played', async () => {
    const { timekeeper, fakes } = buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING', roundNumber: 4 })],
      playedCards: []
    });

    await timekeeper.onPlayExpired(ROUND_ID);

    const round = await fakes.rounds.findById(ROUND_ID);
    expect(round?.status).toBe('ABORTED');
    expect(fakes.rotator.rotations).toEqual([
      { roomCode: ROOM_CODE, currentRound: 4 }
    ]);
  });
});

describe('RoundTimekeeper.armJudgeGrace', () => {
  it('holds the Round and arms the judge-grace key without changing phase', async () => {
    const { timekeeper, fakes } = buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })]
    });

    const before = Date.now();
    await timekeeper.armJudgeGrace(ROUND_ID);

    expect(fakes.store.armed.get(judgeKey(ROUND_ID))).toBe(30);
    const round = await fakes.rounds.findById(ROUND_ID);
    // The Round is held awaiting reconnect — phase is untouched.
    expect(round?.status).toBe('PLAYING');
    expect(round?.judgeDeadline?.getTime()).toBeGreaterThanOrEqual(before + 30_000);
  });
});

describe('RoundTimekeeper.onJudgeExpired', () => {
  it('aborts the Round and rotates the Judge when grace lapses', async () => {
    const { timekeeper, fakes } = buildTimekeeper({
      rounds: [makeRound({ status: 'JUDGING', roundNumber: 7 })]
    });

    await timekeeper.onJudgeExpired(ROUND_ID);

    const round = await fakes.rounds.findById(ROUND_ID);
    expect(round?.status).toBe('ABORTED');
    expect(fakes.rotator.rotations).toEqual([
      { roomCode: ROOM_CODE, currentRound: 7 }
    ]);
  });
});

describe('RoundTimekeeper idempotency', () => {
  it('rotates only once when a play-expiry event is replayed', async () => {
    const { timekeeper, fakes } = buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })],
      playedCards: []
    });

    await timekeeper.onPlayExpired(ROUND_ID);
    await timekeeper.onPlayExpired(ROUND_ID);

    expect(fakes.rotator.rotations).toHaveLength(1);
  });

  it('rotates only once when a judge-expiry event is replayed', async () => {
    const { timekeeper, fakes } = buildTimekeeper({
      rounds: [makeRound({ status: 'JUDGING' })]
    });

    await timekeeper.onJudgeExpired(ROUND_ID);
    await timekeeper.onJudgeExpired(ROUND_ID);

    expect(fakes.rotator.rotations).toHaveLength(1);
  });
});

describe('RoundTimekeeper.reconcile', () => {
  it('advances a Round whose play deadline passed while unsubscribed', async () => {
    const past = new Date(Date.now() - 60_000);
    const { timekeeper, fakes } = buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING', playDeadline: past, roundNumber: 2 })],
      playedCards: []
    });

    await timekeeper.reconcile();

    const round = await fakes.rounds.findById(ROUND_ID);
    expect(round?.status).toBe('ABORTED');
    expect(fakes.rotator.rotations).toEqual([
      { roomCode: ROOM_CODE, currentRound: 2 }
    ]);
  });

  it('leaves a Round whose deadline has not passed untouched', async () => {
    const future = new Date(Date.now() + 60_000);
    const { timekeeper, fakes } = buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING', playDeadline: future })],
      playedCards: []
    });

    await timekeeper.reconcile();

    const round = await fakes.rounds.findById(ROUND_ID);
    expect(round?.status).toBe('PLAYING');
    expect(fakes.rotator.rotations).toHaveLength(0);
  });
});

describe('RoundTimekeeper.onExpired', () => {
  it('routes a play key to the play-expiry transition', async () => {
    const { timekeeper, fakes } = buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })],
      playedCards: [makePlayedCard('player-a')]
    });

    await timekeeper.onExpired(playKey(ROUND_ID));

    expect((await fakes.rounds.findById(ROUND_ID))?.status).toBe('JUDGING');
  });

  it('routes a judge key to the judge-expiry transition', async () => {
    const { timekeeper, fakes } = buildTimekeeper({
      rounds: [makeRound({ status: 'JUDGING' })]
    });

    await timekeeper.onExpired(judgeKey(ROUND_ID));

    expect((await fakes.rounds.findById(ROUND_ID))?.status).toBe('ABORTED');
  });

  it('ignores an unrelated expired key', async () => {
    const { timekeeper, fakes } = buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })]
    });

    await timekeeper.onExpired('session:xyz');

    expect((await fakes.rounds.findById(ROUND_ID))?.status).toBe('PLAYING');
    expect(fakes.rotator.rotations).toHaveLength(0);
  });
});

describe('parseDeadlineKey', () => {
  it('decodes play and judge keys, rejecting foreign keys', () => {
    expect(parseDeadlineKey(playKey('abc'))).toEqual({
      roundId: 'abc',
      kind: 'play'
    });
    expect(parseDeadlineKey(judgeKey('abc'))).toEqual({
      roundId: 'abc',
      kind: 'judge'
    });
    expect(parseDeadlineKey('session:xyz')).toBeNull();
  });
});
