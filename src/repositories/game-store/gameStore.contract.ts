import { describe, expect, it } from 'vitest';
import type { IGameStore } from './IGameStore';
import {
  type GameStoreHarness,
  ROOM_CODE,
  makePlayer,
  makeRoom,
  makeRound,
  makeWhiteCard,
  openWithRounds,
  seedGame
} from './gameStore.fixtures';
import {
  describeCardDraws,
  describeRoomsAndPlayers
} from './gameStore.roomContract';

/**
 * What the game loop may rely on from any IGameStore. Every case runs against
 * both adapters (gameStore.contract.spec), so the in-memory store can't drift
 * from Postgres: when they disagree, a case fails. See issue #24.
 *
 * @example
 * describeGameStoreContract({ name: 'in-memory', users, open: async pool => new InMemoryGameStore(pool) });
 */
// biome-ignore lint/suspicious/noExportsInTest: a shared suite, not a spec; gameStore.contract.spec runs it per adapter.
export function describeGameStoreContract(harness: GameStoreHarness): void {
  describe(`IGameStore contract: ${harness.name}`, () => {
    describeJudgeDerivation(harness);
    describePlayedCards(harness);
    describePhaseClaim(harness);
    describeExpiredActive(harness);
    describeStalledEnded(harness);
    describeCardDraws(harness);
    describeRoomsAndPlayers(harness);
  });
}

function describeJudgeDerivation(harness: GameStoreHarness): void {
  it('derives isJudge from the Room Judge and follows a rotation', async () => {
    const store = await harness.open();
    await seedGame(
      store,
      {
        room: makeRoom({ judgeId: 'player-a', hostId: 'player-a' }),
        // A stale stored flag must lose to the Room's judgeId.
        players: [
          makePlayer({ id: 'player-a' }),
          makePlayer({ id: 'player-b', isJudge: true })
        ]
      },
      harness.users
    );

    expect(await judgeFlags(store)).toEqual({
      'player-a': true,
      'player-b': false
    });

    await store.rooms.update(ROOM_CODE, {
      judgeId: 'player-b',
      prevJudgeId: 'player-a'
    });

    expect(await judgeFlags(store)).toEqual({
      'player-a': false,
      'player-b': true
    });
    const judge = await store.players.getPlayerFromRoom(ROOM_CODE, 'player-b');
    expect(judge?.isJudge).toBe(true);
  });
}

function describePlayedCards(harness: GameStoreHarness): void {
  async function openWithRound(): Promise<IGameStore> {
    const store = await harness.open();
    await seedGame(
      store,
      {
        room: makeRoom(),
        players: [
          makePlayer({ id: 'player-judge' }),
          makePlayer({
            id: 'player-a',
            username: 'Ana',
            avatarUrl: 'https://a.test/ana.png'
          })
        ],
        rounds: [makeRound()]
      },
      harness.users
    );
    return store;
  }

  it('reads Played Cards back straight after the write, in submitted order', async () => {
    const store = await openWithRound();

    const created = await store.playedCards.create({
      roundId: 'round-1',
      playerId: 'player-a',
      whiteCardIds: ['w3', 'w1']
    });
    const playedCards = await store.playedCards.findByRoomCodeAndRoundNumber(
      ROOM_CODE,
      1
    );

    expect(playedCards).toEqual([
      expect.objectContaining({
        id: created.id,
        roundId: 'round-1',
        player: {
          id: 'player-a',
          username: 'Ana',
          avatarUrl: 'https://a.test/ana.png'
        },
        whiteCards: [makeWhiteCard('w3'), makeWhiteCard('w1')]
      })
    ]);
  });

  it('returns no Played Cards for a Round that does not exist', async () => {
    const store = await openWithRound();

    expect(
      await store.playedCards.findByRoomCodeAndRoundNumber(ROOM_CODE, 9)
    ).toEqual([]);
  });

  it('rejects a second Played Cards entry by the same Player in a Round', async () => {
    const store = await openWithRound();
    const answer = {
      roundId: 'round-1',
      playerId: 'player-a',
      whiteCardIds: ['w1']
    };
    await store.playedCards.create(answer);

    await expect(
      store.playedCards.create({ ...answer, whiteCardIds: ['w2'] })
    ).rejects.toThrow();

    const playedCards = await store.playedCards.findByRoomCodeAndRoundNumber(
      ROOM_CODE,
      1
    );
    expect(
      playedCards.map(entry => entry.whiteCards.map(card => card.id))
    ).toEqual([['w1']]);
  });

  // A write that fails on its White Cards must leave nothing behind, or the
  // Player's corrected retry is rejected as a second answer.
  it('keeps nothing from a failed write, so a corrected retry succeeds', async () => {
    const store = await openWithRound();
    const answer = { roundId: 'round-1', playerId: 'player-a' };

    await expect(
      store.playedCards.create({
        ...answer,
        whiteCardIds: ['w1', 'no-such-card']
      })
    ).rejects.toThrow();
    await store.playedCards.create({ ...answer, whiteCardIds: ['w2'] });

    const playedCards = await store.playedCards.findByRoomCodeAndRoundNumber(
      ROOM_CODE,
      1
    );
    expect(
      playedCards.map(entry => entry.whiteCards.map(card => card.id))
    ).toEqual([['w2']]);
  });
}

// ADR-0003: the claim is the idempotency guard for expiry events, the startup
// sweep and a second instance, so it must hold on the real SQL.
function describePhaseClaim(harness: GameStoreHarness): void {
  it('wins a claim once and returns null when it is replayed', async () => {
    const store = await openWithRounds(harness, [
      makeRound({ status: 'PLAYING' })
    ]);

    const first = await store.rounds.claimAdvance(
      'round-1',
      'PLAYING',
      'JUDGING'
    );
    const replay = await store.rounds.claimAdvance(
      'round-1',
      'PLAYING',
      'JUDGING'
    );

    expect(first).toEqual(
      expect.objectContaining({ id: 'round-1', status: 'JUDGING' })
    );
    expect(replay).toBeNull();
    expect((await store.rounds.findById('round-1'))?.status).toBe('JUDGING');
  });

  it('claims from any of the allowed phases', async () => {
    const store = await openWithRounds(harness, [
      makeRound({ status: 'JUDGING' })
    ]);

    const aborted = await store.rounds.claimAdvance(
      'round-1',
      ['PLAYING', 'JUDGING'],
      'ABORTED'
    );

    expect(aborted?.status).toBe('ABORTED');
  });

  it('refuses to abort a COMPLETE Round', async () => {
    const store = await openWithRounds(harness, [
      makeRound({ status: 'COMPLETE' })
    ]);

    const aborted = await store.rounds.claimAdvance(
      'round-1',
      ['PLAYING', 'JUDGING'],
      'ABORTED'
    );

    expect(aborted).toBeNull();
    expect((await store.rounds.findById('round-1'))?.status).toBe('COMPLETE');
  });

  it('returns null when claiming a Round that does not exist', async () => {
    const store = await openWithRounds(harness, []);

    expect(
      await store.rounds.claimAdvance('round-x', 'PLAYING', 'JUDGING')
    ).toBeNull();
  });
}

// The startup sweep's source: active Rounds whose play or Judge deadline is
// already behind `now`. Everything else must stay out of the sweep.
function describeExpiredActive(harness: GameStoreHarness): void {
  const now = new Date('2026-01-01T12:00:00Z');
  const past = new Date('2026-01-01T11:59:00Z');
  const future = new Date('2026-01-01T12:01:00Z');

  it('returns only PLAYING or JUDGING Rounds past a deadline', async () => {
    const store = await openWithRounds(harness, [
      makeRound({
        id: 'play-late',
        roundNumber: 1,
        status: 'PLAYING',
        playDeadline: past
      }),
      makeRound({
        id: 'judge-late',
        roundNumber: 2,
        status: 'JUDGING',
        judgeDeadline: past
      }),
      makeRound({
        id: 'on-time',
        roundNumber: 3,
        status: 'PLAYING',
        playDeadline: future
      }),
      makeRound({ id: 'no-clock', roundNumber: 4, status: 'PLAYING' }),
      makeRound({
        id: 'done',
        roundNumber: 5,
        status: 'COMPLETE',
        playDeadline: past
      }),
      makeRound({
        id: 'dead',
        roundNumber: 6,
        status: 'ABORTED',
        judgeDeadline: past
      })
    ]);

    const expired = await store.rounds.findExpiredActive(now);

    expect(expired.map(round => round.id).sort()).toEqual([
      'judge-late',
      'play-late'
    ]);
  });

  it('treats a deadline equal to now as expired', async () => {
    const store = await openWithRounds(harness, [
      makeRound({ playDeadline: now })
    ]);

    const expired = await store.rounds.findExpiredActive(now);

    expect(expired.map(round => round.id)).toEqual(['round-1']);
  });
}

// The rotation backstop's source: an ended Round of a live Room whose next
// Round never opened, once it has been ended long enough not to be mid-rotation.
function describeStalledEnded(harness: GameStoreHarness): void {
  const cutoff = new Date('2026-01-01T12:00:00Z');
  const before = new Date('2026-01-01T11:59:00Z');
  const after = new Date('2026-01-01T12:01:00Z');

  it('returns ended Rounds with no next Round, ended by the cutoff', async () => {
    const store = await openWithRounds(harness, [
      makeRound({
        id: 'rotated',
        roundNumber: 1,
        status: 'COMPLETE',
        updatedAt: before
      }),
      makeRound({
        id: 'stuck',
        roundNumber: 2,
        status: 'ABORTED',
        updatedAt: before
      })
    ]);

    const stalled = await store.rounds.findStalledEnded(cutoff);

    expect(stalled.map(round => round.id)).toEqual(['stuck']);
  });

  it('skips active Rounds and Rounds ended after the cutoff', async () => {
    const store = await openWithRounds(harness, [
      makeRound({
        id: 'live',
        roundNumber: 1,
        status: 'PLAYING',
        updatedAt: before
      }),
      makeRound({
        id: 'fresh',
        roundNumber: 2,
        status: 'COMPLETE',
        updatedAt: after
      })
    ]);

    expect(await store.rounds.findStalledEnded(cutoff)).toEqual([]);
  });

  it('skips the last Round of a finished Room', async () => {
    const store = await harness.open();
    await seedGame(
      store,
      {
        room: makeRoom({ status: 'FINISHED' }),
        rounds: [makeRound({ status: 'COMPLETE', updatedAt: before })]
      },
      harness.users
    );

    expect(await store.rounds.findStalledEnded(cutoff)).toEqual([]);
  });
}

async function judgeFlags(store: IGameStore): Promise<Record<string, boolean>> {
  const players = await store.players.getRoomPlayersByCode(ROOM_CODE);
  return Object.fromEntries(players.map(player => [player.id, player.isJudge]));
}
