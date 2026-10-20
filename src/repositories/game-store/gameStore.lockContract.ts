import type { AdmitPlayer } from '@/repositories/room-players';
import type { Player, Round } from '@/schemas';
import { expect, it, vi } from 'vitest';
import type { IGameStore } from './IGameStore';
import {
  type GameStoreHarness,
  ROOM_CODE,
  makePlayer,
  makeRoom,
  makeRound,
  seedGame
} from './gameStore.fixtures';

// The race guards half of the IGameStore contract: a start claimed only from
// LOBBY, joins judged on the locked Room, plays judged on the locked Round.
// Wired in by describeGameStoreContract.

/**
 * Check-then-write paths that two requests can race through.
 *
 * @example
 * describeRaceGuards(harness); // inside describeGameStoreContract
 */
// biome-ignore lint/suspicious/noExportsInTest: part of the shared contract suite.
export function describeRaceGuards(harness: GameStoreHarness): void {
  describeStartClaim(harness);
  describeLockedJoin(harness);
  describeLockedPlay(harness);
}

function describeStartClaim(harness: GameStoreHarness): void {
  it('lets only one of two racing starts claim a LOBBY Room', async () => {
    const store = await harness.open();
    await seedGame(
      store,
      { room: makeRoom({ status: 'LOBBY', round: 0 }) },
      harness.users
    );

    const claims = await Promise.all([
      store.rooms.claimStart(ROOM_CODE, { status: 'IN_PROGRESS', round: 1 }),
      store.rooms.claimStart(ROOM_CODE, { status: 'IN_PROGRESS', round: 1 })
    ]);

    expect(claims.filter(room => room !== null)).toHaveLength(1);
    const room = await store.rooms.getRoomByCode(ROOM_CODE);
    expect(room).toEqual(
      expect.objectContaining({ status: 'IN_PROGRESS', round: 1 })
    );
  });

  it('refuses to claim a Room that already left LOBBY', async () => {
    const store = await harness.open();
    await seedGame(
      store,
      { room: makeRoom({ status: 'IN_PROGRESS', round: 4 }) },
      harness.users
    );

    const claim = await store.rooms.claimStart(ROOM_CODE, { round: 1 });

    expect(claim).toBeNull();
    expect((await store.rooms.getRoomByCode(ROOM_CODE))?.round).toBe(4);
  });
}

// Admits up to the Room's maxPlayers, like RoomService.assertCanJoin.
function admitUnlessFull(player: Player): AdmitPlayer {
  return (room, players) => {
    if (players.length >= room.maxPlayers) {
      throw new Error(
        `Room ${room.code} full: ${players.length}/${room.maxPlayers} (expected a free seat)`
      );
    }
    return player;
  };
}

async function registerPlayers(
  harness: GameStoreHarness,
  ids: string[]
): Promise<Player[]> {
  const players = ids.map(id => makePlayer({ id }));
  for (const { id, username, avatarUrl } of players) {
    await harness.users?.registerUser({ id, username, avatarUrl });
  }
  return players;
}

function describeLockedJoin(harness: GameStoreHarness): void {
  it('seats only one of two joins racing for the last seat', async () => {
    const store = await harness.open();
    await seedGame(
      store,
      {
        room: makeRoom({ status: 'LOBBY', maxPlayers: 2 }),
        players: [makePlayer({ id: 'player-judge' })]
      },
      harness.users
    );
    const [ana, bo] = await registerPlayers(harness, ['player-a', 'player-b']);

    const joins = await Promise.allSettled([
      store.players.addPlayerToLockedRoom({
        roomCode: ROOM_CODE,
        admit: admitUnlessFull(ana)
      }),
      store.players.addPlayerToLockedRoom({
        roomCode: ROOM_CODE,
        admit: admitUnlessFull(bo)
      })
    ]);

    expect(joins.map(join => join.status).sort()).toEqual([
      'fulfilled',
      'rejected'
    ]);
    expect(await store.players.getRoomPlayersByCode(ROOM_CODE)).toHaveLength(2);
  });

  it('returns undefined and inserts nothing for a missing Room', async () => {
    const store = await harness.open();
    const admit = vi.fn<Parameters<AdmitPlayer>, Player>();

    const room = await store.players.addPlayerToLockedRoom({
      roomCode: 'NOPE00',
      admit
    });

    expect(room).toBeUndefined();
    expect(admit).not.toHaveBeenCalled();
  });
}

function refuseUnlessPlaying(round: Round): void {
  if (round.status !== 'PLAYING') {
    throw new Error(`Round ${round.id} is ${round.status} (expected PLAYING)`);
  }
}

async function playedCount(store: IGameStore): Promise<number> {
  const answers = await store.playedCards.findByRoomCodeAndRoundNumber(
    ROOM_CODE,
    1
  );
  return answers.length;
}

async function openWithPlayingRound(
  harness: GameStoreHarness
): Promise<IGameStore> {
  const store = await harness.open();
  await seedGame(
    store,
    {
      room: makeRoom(),
      players: [makePlayer({ id: 'player-a' })],
      rounds: [makeRound()]
    },
    harness.users
  );
  return store;
}

function describeLockedPlay(harness: GameStoreHarness): void {
  it('judges a play on the Round as stored at write time', async () => {
    const store = await openWithPlayingRound(harness);
    await store.rounds.claimAdvance('round-1', 'PLAYING', 'JUDGING');

    const play = store.playedCards.createInLockedRound(
      { roundId: 'round-1', playerId: 'player-a', whiteCardIds: ['w1'] },
      refuseUnlessPlaying
    );

    await expect(play).rejects.toThrow('is JUDGING');
    expect(await playedCount(store)).toBe(0);
  });

  it('records a play the Round still accepts', async () => {
    const store = await openWithPlayingRound(harness);

    await store.playedCards.createInLockedRound(
      { roundId: 'round-1', playerId: 'player-a', whiteCardIds: ['w1'] },
      refuseUnlessPlaying
    );

    expect(await playedCount(store)).toBe(1);
  });
}
