import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import { InMemoryGameStore } from '@/repositories/game-store/InMemoryGameStore';
import type { InMemoryRoundRepository } from '@/repositories/game-store/in-memory/InMemoryRoundRepository';
import {
  ROOM_CODE,
  makePlayer,
  makeRoom,
  makeRound,
  makeWhiteCard,
  seedGame
} from '@/repositories/game-store/gameStore.fixtures';
import type { Round, RoundPlayedCard } from '@/schemas';
import { FakeGameEventPublisher } from '@/services/IGameEventPublisher.fakes';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FakeRoundRotator,
  FakeRoundTimerStore
} from './RoundTimekeeper.fakes';
import { RoundTimekeeper } from './RoundTimekeeper';
import { judgeKey, parseDeadlineKey, playKey } from './deadlineKeys';

const ROUND_ID = 'round-1';

// A value handed straight to advanceToJudging (not seeded into the store).
function makePlayedCard(playerId: string): RoundPlayedCard {
  return {
    id: `played-${playerId}`,
    roundId: ROUND_ID,
    player: {
      id: playerId,
      username: playerId,
      avatarUrl: null
    },
    whiteCards: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

type Fakes = {
  store: FakeRoundTimerStore;
  rounds: InMemoryRoundRepository;
  rotator: FakeRoundRotator;
  publisher: FakeGameEventPublisher;
};

// Rounds live in the shared InMemoryGameStore, so the claim and the play count
// are the production rules. `playedBy` seeds one real play per Player id.
async function buildTimekeeper(args: {
  rounds: Round[];
  playedBy?: string[];
}): Promise<{ timekeeper: RoundTimekeeper; fakes: Fakes; output: FakeConsoleOutput }> {
  const playedBy = args.playedBy ?? [];
  const game = new InMemoryGameStore({ whiteCards: [makeWhiteCard('w1')], blackCards: [] });
  await seedGame(game, {
    room: makeRoom(),
    players: playedBy.map(id => makePlayer({ id })),
    rounds: args.rounds,
    playedCards: playedBy.map(playerId => ({ roundId: ROUND_ID, playerId, whiteCardIds: ['w1'] }))
  });

  const fakes: Fakes = {
    store: new FakeRoundTimerStore(),
    rounds: game.rounds,
    rotator: new FakeRoundRotator(),
    publisher: new FakeGameEventPublisher()
  };

  const output = new FakeConsoleOutput();
  const { logger } = buildLogger({ consoleOutput: output });
  const timekeeper = new RoundTimekeeper(
    fakes.store,
    game.rounds,
    game.playedCards,
    fakes.rotator,
    fakes.publisher,
    { playWindowSeconds: 60, judgeGraceSeconds: 30, judgeWindowSeconds: 90 },
    logger
  );

  return { timekeeper, fakes, output };
}

describe('RoundTimekeeper.armPlayDeadline', () => {
  it('arms the Redis play key with the configured TTL', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({ rounds: [makeRound()] });

    await timekeeper.armPlayDeadline(ROUND_ID);

    expect(fakes.store.armed.get(playKey(ROUND_ID))).toBe(60);
  });

  it('persists the play deadline on the Round as a Postgres backstop', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({ rounds: [makeRound()] });

    const before = Date.now();
    await timekeeper.armPlayDeadline(ROUND_ID);

    const round = await fakes.rounds.findById(ROUND_ID);
    expect(round?.status).toBe('PLAYING');
    expect(round?.playDeadline?.getTime()).toBeGreaterThanOrEqual(before + 60_000);
  });
});

describe('RoundTimekeeper.onPlayExpired', () => {
  it('moves to JUDGING when at least one Player played, skipping the rest', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })],
      playedBy: ['player-a']
    });

    await timekeeper.onPlayExpired(ROUND_ID);

    const round = await fakes.rounds.findById(ROUND_ID);
    expect(round?.status).toBe('JUDGING');
    // Judging proceeds with what was submitted; no abort/rotation.
    expect(fakes.rotator.rotations).toHaveLength(0);
  });

  it('aborts the Round and rotates the Judge when nobody played', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING', roundNumber: 4 })],
      playedBy: []
    });

    await timekeeper.onPlayExpired(ROUND_ID);

    const round = await fakes.rounds.findById(ROUND_ID);
    expect(round?.status).toBe('ABORTED');
    expect(fakes.rotator.rotations).toEqual([
      { roomCode: ROOM_CODE, currentRound: 4 }
    ]);
  });
});

describe('RoundTimekeeper.advanceToJudging', () => {
  it('claims PLAYING->JUDGING and broadcasts time-to-judge once with the plays', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })]
    });
    const plays = [makePlayedCard('player-a')];

    const advanced = await timekeeper.advanceToJudging(makeRound(), plays);

    expect(advanced).toBe(true);
    const round = await fakes.rounds.findById(ROUND_ID);
    expect(round?.status).toBe('JUDGING');
    expect(fakes.publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.time-to-judge',
          payload: { roundNumber: 1, roundPlayedCards: plays }
        }
      }
    ]);
  });

  it('is idempotent: a second caller wins no claim and does not re-broadcast', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })]
    });
    const round = makeRound();
    const plays = [makePlayedCard('player-a')];

    const first = await timekeeper.advanceToJudging(round, plays);
    const second = await timekeeper.advanceToJudging(round, plays);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(fakes.publisher.published).toHaveLength(1);
  });
});

describe('RoundTimekeeper.armJudgeGrace', () => {
  it('holds the Round and arms the judge-grace key without changing phase', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
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
    const { timekeeper, fakes } = await buildTimekeeper({
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
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })],
      playedBy: []
    });

    await timekeeper.onPlayExpired(ROUND_ID);
    await timekeeper.onPlayExpired(ROUND_ID);

    expect(fakes.rotator.rotations).toHaveLength(1);
  });

  it('rotates only once when a judge-expiry event is replayed', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
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
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING', playDeadline: past, roundNumber: 2 })],
      playedBy: []
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
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING', playDeadline: future })],
      playedBy: []
    });

    await timekeeper.reconcile();

    const round = await fakes.rounds.findById(ROUND_ID);
    expect(round?.status).toBe('PLAYING');
    expect(fakes.rotator.rotations).toHaveLength(0);
  });
});

describe('RoundTimekeeper.onExpired', () => {
  it('routes a play key to the play-expiry transition', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })],
      playedBy: ['player-a']
    });

    await timekeeper.onExpired(playKey(ROUND_ID));

    expect((await fakes.rounds.findById(ROUND_ID))?.status).toBe('JUDGING');
  });

  it('routes a judge key to the judge-expiry transition', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'JUDGING' })]
    });

    await timekeeper.onExpired(judgeKey(ROUND_ID));

    expect((await fakes.rounds.findById(ROUND_ID))?.status).toBe('ABORTED');
  });

  it('ignores an unrelated expired key', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })]
    });

    await timekeeper.onExpired('session:xyz');

    expect((await fakes.rounds.findById(ROUND_ID))?.status).toBe('PLAYING');
    expect(fakes.rotator.rotations).toHaveLength(0);
  });
});

describe('RoundTimekeeper broadcasts a timer-driven advance', () => {
  it('publishes room.time-to-judge once when the play window closes with plays', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })],
      playedBy: ['player-a']
    });

    await timekeeper.onPlayExpired(ROUND_ID);
    await timekeeper.onPlayExpired(ROUND_ID);

    const judging = fakes.publisher.published.filter(
      p => p.event.event === 'room.time-to-judge'
    );
    expect(judging).toHaveLength(1);
    expect(judging[0].channel).toBe(ROOM_CODE);
  });

  it('publishes room.round-start once when an aborted Round rotates', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'JUDGING' })]
    });

    await timekeeper.onJudgeExpired(ROUND_ID);
    await timekeeper.onJudgeExpired(ROUND_ID);

    const starts = fakes.publisher.published.filter(
      p => p.event.event === 'room.round-start'
    );
    expect(starts).toHaveLength(1);
    expect(starts[0].channel).toBe(ROOM_CODE);
  });

  it('announces the aborted Round with no winner before the next starts', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'JUDGING', roundNumber: 7 })]
    });

    await timekeeper.onJudgeExpired(ROUND_ID);

    const events = fakes.publisher.published.map(p => p.event);
    expect(events).toEqual([
      {
        event: 'room.round-end',
        payload: {
          roundNumber: 7,
          winner: null,
          winnerId: null,
          newScore: null,
          reason: 'aborted'
        }
      },
      {
        event: 'room.round-start',
        payload: {
          roundNumber: 8,
          judgeId: 'fake-next-judge',
          blackCard: { text: 'next black card', pick: 1, packId: 'fake-pack' }
        }
      }
    ]);
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

describe('RoundTimekeeper keeps every Round on a clock', () => {
  it('arms the play deadline of the Round opened by an abort', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING', roundNumber: 3 })],
      playedBy: []
    });

    await timekeeper.onPlayExpired(ROUND_ID);

    expect(fakes.store.armed.get(playKey('fake-round-4'))).toBe(60);
  });

  it('arms a judging deadline when the Round reaches judging', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })]
    });

    await timekeeper.advanceToJudging(makeRound(), [makePlayedCard('player-a')]);

    expect(fakes.store.armed.get(judgeKey(ROUND_ID))).toBe(90);
    expect((await fakes.rounds.findById(ROUND_ID))?.judgeDeadline).not.toBeNull();
  });
});

describe('RoundTimekeeper.onJudgeReturned', () => {
  it('cancels the drop grace while playing so the Round is not aborted', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'PLAYING' })]
    });
    await timekeeper.armJudgeGrace(ROUND_ID);

    await timekeeper.onJudgeReturned(ROUND_ID);

    expect(fakes.store.cleared).toEqual([judgeKey(ROUND_ID)]);
    expect((await fakes.rounds.findById(ROUND_ID))?.judgeDeadline).toBeNull();
  });

  it('restores a full judging window while judging', async () => {
    const { timekeeper, fakes } = await buildTimekeeper({
      rounds: [makeRound({ status: 'JUDGING' })]
    });
    await timekeeper.armJudgeGrace(ROUND_ID);

    await timekeeper.onJudgeReturned(ROUND_ID);

    expect(fakes.store.armed.get(judgeKey(ROUND_ID))).toBe(90);
  });
});


describe('Round timer logging', () => {
  it('logs only the winning judging transition without private cards', async () => {
    const { timekeeper, output } = await buildTimekeeper({ rounds: [makeRound()] });
    await timekeeper.advanceToJudging(makeRound(), [makePlayedCard('player-a')]);
    await timekeeper.advanceToJudging(makeRound(), [makePlayedCard('player-a')]);
    expect(output.lines.map(line => JSON.parse(line).event)).toEqual(['round.judging_started']);
    expect(JSON.parse(output.lines[0])).toMatchObject({ roomCode: ROOM_CODE, roundId: ROUND_ID, playedCount: 1 });
    expect(output.lines.join('')).not.toContain('whiteCards');
  });

  it('records reconciliation counts and an idempotent abort', async () => {
    const { timekeeper, output } = await buildTimekeeper({ rounds: [makeRound({ playDeadline: new Date(0) })] });
    await timekeeper.reconcile();
    await timekeeper.onPlayExpired(ROUND_ID);
    expect(output.lines.map(line => JSON.parse(line).event)).toEqual([
      'round.reconciliation_started', 'round.aborted', 'round.reconciliation_completed'
    ]);
    expect(JSON.parse(output.lines[1])).toMatchObject({ phase: 'PLAYING', roundNumber: 1, level: 40 });
  });
});
