import { BlackCardDeck } from '@/services/room/BlackCardDeck';
import { WhiteCardDealer } from '@/services/room/WhiteCardDealer';
import { expect, it } from 'vitest';
import {
  type GameStoreHarness,
  ROOM_CODE,
  makePlayer,
  makeRoom,
  makeRound,
  openWithRounds,
  seedGame
} from './gameStore.fixtures';

// The Room, Player and card-draw half of the IGameStore contract; wired in by
// describeGameStoreContract. See issue #24.

/**
 * Card draws as Room side effects: a drawn Black Card becomes current and is
 * recorded so it doesn't repeat; dealt White Cards join the Room's ledger.
 *
 * @example
 * describeCardDraws(harness); // inside describeGameStoreContract
 */
// biome-ignore lint/suspicious/noExportsInTest: part of the shared contract suite.
export function describeCardDraws(harness: GameStoreHarness): void {
  it('drawing a Black Card makes it the Room current Black Card', async () => {
    const store = await harness.open();
    await seedGame(
      store,
      { room: makeRoom({ currentBlackCardId: null, pickedBlackCards: [] }) },
      harness.users
    );

    const drawn = await new BlackCardDeck(store).drawBlackCard(ROOM_CODE);

    const room = await store.rooms.getRoomByCode(ROOM_CODE);
    expect(room?.currentBlackCardId).toBe(drawn.id);
    expect(room?.pickedBlackCards).toEqual([drawn.id]);
    expect(
      await new BlackCardDeck(store).findBlackCard(ROOM_CODE, drawn.id)
    ).toEqual(drawn);
  });

  it('dealing White Cards records them on the Room so they do not repeat', async () => {
    const store = await harness.open();
    await seedGame(store, { room: makeRoom() }, harness.users);
    const dealer = new WhiteCardDealer(store);

    const first = await dealer.dealWhiteCards(ROOM_CODE, 2);
    const second = await dealer.dealWhiteCards(ROOM_CODE, 2);

    const dealtIds = [...first, ...second].map(card => card.id).sort();
    expect(dealtIds).toEqual(['w1', 'w2', 'w3', 'w4']);
    const room = await store.rooms.getRoomByCode(ROOM_CODE);
    expect([...(room?.pickedWhiteCards ?? [])].sort()).toEqual(dealtIds);
  });
}

/**
 * Room and Player rows: Code-keyed updates, join defaults, writable columns,
 * scoring and Ranking, Leave, unique Round numbers and the public lobby list.
 *
 * @example
 * describeRoomsAndPlayers(harness); // inside describeGameStoreContract
 */
// biome-ignore lint/suspicious/noExportsInTest: part of the shared contract suite.
export function describeRoomsAndPlayers(harness: GameStoreHarness): void {
  it('keys Room updates by Code: any other key changes nothing', async () => {
    const store = await harness.open();
    await seedGame(
      store,
      { room: makeRoom({ id: 'room-1', round: 1 }) },
      harness.users
    );

    const missed = await store.rooms.update('room-1', { round: 2 });
    const hit = await store.rooms.update(ROOM_CODE, { round: 3 });

    expect(missed).toBeUndefined();
    expect(hit.round).toBe(3);
    expect((await store.rooms.getRoomByCode(ROOM_CODE))?.round).toBe(3);
  });

  it('joins a Player with no score, an empty Hand and as active', async () => {
    const store = await harness.open();
    await seedGame(store, { room: makeRoom() }, harness.users);
    await harness.users?.registerUser({
      id: 'player-a',
      username: 'Ana',
      avatarUrl: null
    });

    await store.players.addPlayerToRoom({
      roomCode: ROOM_CODE,
      player: makePlayer({
        id: 'player-a',
        username: 'Ana',
        score: 7,
        isActive: false,
        cardIds: ['w1'],
        isHost: true
      })
    });

    expect(
      await store.players.getPlayerFromRoom(ROOM_CODE, 'player-a')
    ).toEqual(
      makePlayer({
        id: 'player-a',
        username: 'Ana',
        score: 0,
        isActive: true,
        cardIds: [],
        isHost: true
      })
    );
    expect(await store.players.getRoomCodesByPlayerId('player-a')).toEqual([
      ROOM_CODE
    ]);
  });

  it('writes several Players at once, columns only', async () => {
    const store = await harness.open();
    const ana = makePlayer({ id: 'player-a', username: 'Ana' });
    const bo = makePlayer({ id: 'player-b', username: 'Bo' });
    await seedGame(
      store,
      { room: makeRoom(), players: [ana, bo] },
      harness.users
    );

    await store.players.updatePlayers(ROOM_CODE, [
      { ...ana, score: 4, cardIds: ['w1'], username: 'Mallory' },
      { ...bo, isActive: false, isJudge: true }
    ]);

    expect(await store.players.getRoomPlayersByCode(ROOM_CODE)).toEqual(
      expect.arrayContaining([
        makePlayer({
          id: 'player-a',
          username: 'Ana',
          score: 4,
          cardIds: ['w1']
        }),
        makePlayer({ id: 'player-b', username: 'Bo', isActive: false })
      ])
    );
  });

  it('ignores identity and isJudge in a Player update', async () => {
    const store = await harness.open();
    await seedGame(
      store,
      {
        room: makeRoom(),
        players: [makePlayer({ id: 'player-a', username: 'Ana' })]
      },
      harness.users
    );

    await store.players.updatePlayerInRoom(ROOM_CODE, 'player-a', {
      username: 'Mallory',
      isJudge: true,
      isReady: true
    });

    const player = await store.players.getPlayerFromRoom(ROOM_CODE, 'player-a');
    expect(player).toEqual(
      expect.objectContaining({
        username: 'Ana',
        isJudge: false,
        isReady: true
      })
    );
  });

  it('scores, resets ready flags and ranks Players by score', async () => {
    const store = await harness.open();
    await seedGame(
      store,
      {
        room: makeRoom(),
        players: [
          makePlayer({ id: 'player-a', score: 1, isReady: true }),
          makePlayer({ id: 'player-b', score: 2, isReady: true })
        ]
      },
      harness.users
    );

    await store.players.incrementPlayerScore({
      roomCode: ROOM_CODE,
      playerId: 'player-a',
      by: 2
    });
    await store.players.setPlayersAsUnready(ROOM_CODE);

    const ranking = await store.ranking.getRankingByRoomCode(ROOM_CODE);
    expect(ranking.map(({ id, score }) => ({ id, score }))).toEqual([
      { id: 'player-a', score: 3 },
      { id: 'player-b', score: 2 }
    ]);
    const players = await store.players.getRoomPlayersByCode(ROOM_CODE);
    expect(players.some(player => player.isReady)).toBe(false);
  });

  it('removes a Player who Leaves but keeps their Played Cards readable', async () => {
    const store = await harness.open();
    await seedGame(
      store,
      {
        room: makeRoom(),
        players: [makePlayer({ id: 'player-a', username: 'Ana' })],
        rounds: [makeRound()],
        playedCards: [
          { roundId: 'round-1', playerId: 'player-a', whiteCardIds: ['w1'] }
        ]
      },
      harness.users
    );

    await store.players.deletePlayerFromRoom(ROOM_CODE, 'player-a');

    expect(
      await store.players.getPlayerFromRoom(ROOM_CODE, 'player-a')
    ).toBeUndefined();
    const [playedCards] = await store.playedCards.findByRoomCodeAndRoundNumber(
      ROOM_CODE,
      1
    );
    expect(playedCards.player).toEqual({
      id: 'player-a',
      username: 'Ana',
      avatarUrl: null
    });
  });

  it('allows one Round per number in a Room', async () => {
    const store = await openWithRounds(harness, [
      makeRound({ id: 'round-1', roundNumber: 1 })
    ]);

    await expect(
      store.rounds.create(makeRound({ id: 'round-dup', roundNumber: 1 }))
    ).rejects.toThrow();
    expect((await store.rounds.find(ROOM_CODE, 1))?.id).toBe('round-1');
  });

  it('lists public LOBBY Rooms with their head count and Host', async () => {
    const store = await harness.open();
    const lobby = {
      status: 'LOBBY' as const,
      hostId: 'player-a',
      judgeId: null
    };
    await seedGame(
      store,
      {
        room: makeRoom({ ...lobby, id: 'r-open', code: 'OPEN01' }),
        players: [makePlayer({ id: 'player-a', username: 'Ana' })]
      },
      harness.users
    );
    await seedGame(
      store,
      {
        room: makeRoom({
          ...lobby,
          id: 'r-priv',
          code: 'PRIV01',
          isPublic: false
        })
      },
      harness.users
    );
    await seedGame(
      store,
      { room: makeRoom({ id: 'r-live', code: 'LIVE01', hostId: 'player-a' }) },
      harness.users
    );

    expect(await store.rooms.listPublicRooms()).toEqual([
      {
        id: 'r-open',
        code: 'OPEN01',
        maxPlayers: 10,
        maxPoints: 5,
        playerCount: 1,
        hostUsername: 'Ana'
      }
    ]);
  });
}
