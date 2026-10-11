import type { Player } from '@/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ROOM_CODE,
  buildService,
  makePlayedCards,
  makePlayer,
  makeRoom,
  makeRound
} from './RoomService.fixtures';

describe('RoomService.scoreRoundWinner', () => {
  async function scoreWinner(maxPoints: number, score: number) {
    const { service } = await buildService({
      room: makeRoom({ maxPoints }),
      players: [
        makePlayer({ id: 'player-judge' }),
        makePlayer({ id: 'player-winner', score })
      ],
      rounds: [makeRound({ status: 'COMPLETE' })]
    });
    const room = await service.getRoom(ROOM_CODE);
    return { service, result: await service.scoreRoundWinner(room, 'player-winner') };
  }

  it('awards one point and keeps the game going below maxPoints', async () => {
    const { result } = await scoreWinner(5, 0);

    expect(result.winnerPlayer.score).toBe(1);
    expect(result.gameEnded).toBe(false);
    expect(result.ranking).toBeNull();
  });

  it('ends the game when the winner reaches maxPoints', async () => {
    const { service, result } = await scoreWinner(2, 1);

    expect(result.gameEnded).toBe(true);
    expect(result.ranking?.[0]).toEqual(
      expect.objectContaining({ id: 'player-winner', score: 2 })
    );
    expect((await service.getRoom(ROOM_CODE)).status).toBe('FINISHED');
  });
});

describe('RoomService.endGame', () => {
  it('marks the Room FINISHED and returns the Ranking', async () => {
    const { service } = await buildService({
      room: makeRoom({ status: 'IN_PROGRESS' }),
      players: [
        makePlayer({ id: 'player-a', score: 3 }),
        makePlayer({ id: 'player-b', score: 5 })
      ],
      rounds: [],
    });

    const ranking = await service.endGame(ROOM_CODE);

    expect(ranking.map(entry => entry.id)).toEqual(['player-b', 'player-a']);
    const room = await service.getRoom(ROOM_CODE);
    expect(room.status).toBe('FINISHED');
  });
});

describe('RoomService.dealInitialHands', () => {
  it('deals 10 White Cards to every Player, including the Judge', async () => {
    const judge = makePlayer({ id: 'player-judge', isJudge: true });
    const other = makePlayer({ id: 'player-other' });
    const { service, store } = await buildService({
      room: makeRoom(),
      players: [judge, other],
      rounds: [],
    });

    const dealt = await service.dealInitialHands({
      roomCode: ROOM_CODE,
      cardsPerPlayer: 10
    });

    expect(dealt.map(hand => hand.playerId).sort()).toEqual([
      'player-judge',
      'player-other'
    ]);
    for (const playerId of ['player-judge', 'player-other']) {
      const player = await store.players.getPlayerFromRoom(ROOM_CODE, playerId);
      expect(player?.cardIds).toHaveLength(10);
    }
  });
});

describe('RoomService.playCards', () => {
  it('refills the Hand back to 10 after a Player plays', async () => {
    const hand = Array.from({ length: 10 }, (_, i) => `hand-${i}`);
    const played = ['hand-0', 'hand-1', 'hand-2'];
    const { service, store } = await buildService({
      room: makeRoom(),
      players: [makePlayer({ id: 'player-hand', cardIds: hand })],
      rounds: [makeRound()],
      blackCards: [{ id: 'black-1', text: 'pick three', pick: 3, packId: 'p' }]
    });

    await service.playCards(ROOM_CODE, 'player-hand', played);

    const player = await store.players.getPlayerFromRoom(
      ROOM_CODE,
      'player-hand'
    );
    expect(player?.cardIds).toHaveLength(10);
    for (const cardId of played) {
      expect(player?.cardIds).not.toContain(cardId);
    }
  });
});

describe('RoomService.setPlayerActive', () => {
  it('marks a Player inactive on drop while keeping them in the Room', async () => {
    const { service, store } = await buildService({
      room: makeRoom(),
      players: [makePlayer({ id: 'player-dropped' })],
      rounds: [],
    });

    const updated = await service.setPlayerActive(
      ROOM_CODE,
      'player-dropped',
      false
    );

    expect(updated.isActive).toBe(false);
    const stillThere = await store.players.getPlayerFromRoom(
      ROOM_CODE,
      'player-dropped'
    );
    expect(stillThere).toBeDefined();
  });

  it('marks a Player active again on reconnect', async () => {
    const { service } = await buildService({
      room: makeRoom(),
      players: [makePlayer({ id: 'player-back', isActive: false })],
      rounds: [],
    });

    const updated = await service.setPlayerActive(
      ROOM_CODE,
      'player-back',
      true
    );

    expect(updated.isActive).toBe(true);
  });

  it('keeps an Inactive Player in the Ranking with their score intact', async () => {
    const { service, store } = await buildService({
      room: makeRoom(),
      players: [makePlayer({ id: 'player-dropped', score: 3 })],
      rounds: [],
    });

    await service.setPlayerActive(ROOM_CODE, 'player-dropped', false);

    const ranking = await store.ranking.getRankingByRoomCode(ROOM_CODE);
    expect(ranking).toContainEqual(
      expect.objectContaining({ id: 'player-dropped', score: 3 })
    );
  });
});

describe('RoomService.handleHostLoss', () => {
  it('ends the Room when the Host is lost while in the LOBBY', async () => {
    const { service } = await buildService({
      room: makeRoom({ status: 'LOBBY', hostId: 'host' }),
      players: [
        makePlayer({ id: 'host', isHost: true }),
        makePlayer({ id: 'guest' })
      ],
      rounds: [],
    });

    const outcome = await service.handleHostLoss(ROOM_CODE, 'host');

    expect(outcome.kind).toBe('room-ended');
    const room = await service.getRoom(ROOM_CODE);
    expect(room.status).toBe('FINISHED');
  });

  it('reassigns the Host to an active Player while IN_PROGRESS', async () => {
    const { service } = await buildService({
      room: makeRoom({ status: 'IN_PROGRESS', hostId: 'host' }),
      players: [
        makePlayer({ id: 'host', isHost: true }),
        makePlayer({ id: 'heir', isActive: true })
      ],
      rounds: [],
    });

    const outcome = await service.handleHostLoss(ROOM_CODE, 'host');

    expect(outcome).toEqual({
      kind: 'host-reassigned',
      newHost: expect.objectContaining({ id: 'heir', isHost: true })
    });
    const room = await service.getRoom(ROOM_CODE);
    expect(room.hostId).toBe('heir');
    expect(room.status).toBe('IN_PROGRESS');
  });

  it('ends the Room when the Host is lost IN_PROGRESS and no active Players remain', async () => {
    const { service } = await buildService({
      room: makeRoom({ status: 'IN_PROGRESS', hostId: 'host' }),
      players: [
        makePlayer({ id: 'host', isHost: true, isActive: false }),
        makePlayer({ id: 'dropped', isActive: false })
      ],
      rounds: [],
    });

    const outcome = await service.handleHostLoss(ROOM_CODE, 'host');

    expect(outcome.kind).toBe('room-ended');
    const room = await service.getRoom(ROOM_CODE);
    expect(room.status).toBe('FINISHED');
  });

  it('leaves a dropped ex-Host as an ordinary active Player on reconnect', async () => {
    const { service, store } = await buildService({
      room: makeRoom({ status: 'IN_PROGRESS', hostId: 'host' }),
      players: [
        // Drop marks the ex-Host inactive but keeps the row (its Host flag still set).
        makePlayer({ id: 'host', isHost: true, isActive: false }),
        makePlayer({ id: 'heir', isActive: true })
      ],
      rounds: [],
    });

    await service.handleHostLoss(ROOM_CODE, 'host');
    const reconnected = await service.setPlayerActive(ROOM_CODE, 'host', true);

    expect(reconnected.isActive).toBe(true);
    expect(reconnected.isHost).toBe(false);
    const room = await store.rooms.getRoomByCode(ROOM_CODE);
    expect(room?.hostId).toBe('heir');
  });

  it('does nothing when the departing Player is not the Host', async () => {
    const { service } = await buildService({
      room: makeRoom({ status: 'IN_PROGRESS', hostId: 'host' }),
      players: [
        makePlayer({ id: 'host', isHost: true }),
        makePlayer({ id: 'guest' })
      ],
      rounds: [],
    });

    const outcome = await service.handleHostLoss(ROOM_CODE, 'guest');

    expect(outcome.kind).toBe('not-host');
    const room = await service.getRoom(ROOM_CODE);
    expect(room.hostId).toBe('host');
    expect(room.status).toBe('IN_PROGRESS');
  });
});

describe('RoomService.getActiveRound', () => {
  it('returns the Round matching the Room current round number', async () => {
    const { service } = await buildService({
      room: makeRoom({ round: 2 }),
      players: [makePlayer({ id: 'player-judge', isJudge: true })],
      rounds: [makeRound({ roundNumber: 1 }), makeRound({ id: 'round-2', roundNumber: 2 })],
    });

    const round = await service.getActiveRound(ROOM_CODE);

    expect(round?.id).toBe('round-2');
  });

  it('returns null when no Round matches the current round number', async () => {
    const { service } = await buildService({
      room: makeRoom({ round: 9 }),
      players: [makePlayer({ id: 'player-judge', isJudge: true })],
      rounds: [makeRound({ roundNumber: 1 })],
    });

    expect(await service.getActiveRound(ROOM_CODE)).toBeNull();
  });
});
