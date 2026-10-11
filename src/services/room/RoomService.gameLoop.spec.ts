import { BadRequestError, ForbiddenError } from '@/errors';
import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE,
  buildService,
  makePlay,
  makePlayer,
  makeRoom,
  makeRound
} from './RoomService.fixtures';

// Regression specs for the gaps that broke the loop past Round 1: the Room
// update keyed by id instead of Code, Players never reset to unready, the Judge
// repeating, and picks/plays outside their phase.

const judge = () => makePlayer({ id: 'player-judge', isJudge: true });

describe('RoomService.startNextRound', () => {
  function buildRotation(roomOverrides = {}) {
    return buildService({
      room: makeRoom({ round: 1, judgeId: 'player-judge', ...roomOverrides }),
      players: [
        judge(),
        makePlayer({ id: 'player-a', isReady: true }),
        makePlayer({ id: 'player-b', isReady: true })
      ],
      rounds: [makeRound({ status: 'COMPLETE' })],
    });
  }

  it('advances the Room round number and records the outgoing Judge', async () => {
    const { service } = await buildRotation();

    const next = await service.startNextRound(ROOM_CODE, 1);

    const room = await service.getRoom(ROOM_CODE);
    expect(next.roundNumber).toBe(2);
    expect(room.round).toBe(2);
    expect(room.judgeId).toBe(next.judgeId);
    expect(room.prevJudgeId).toBe('player-judge');
  });

  it('never hands the Judge role straight back to the outgoing Judge', async () => {
    for (let i = 0; i < 20; i++) {
      const { service } = await buildRotation();
      const next = await service.startNextRound(ROOM_CODE, 1);
      expect(next.judgeId).not.toBe('player-judge');
    }
  });

  it('resets every Player to unready so they can play the new Round', async () => {
    const { service, store } = await buildRotation();

    await service.startNextRound(ROOM_CODE, 1);

    const players = await store.players.getRoomPlayersByCode(ROOM_CODE);
    expect(players.every(player => !player.isReady)).toBe(true);
  });

  it('rejects a stale rotation for a Round the Room already left', async () => {
    const { service } = await buildRotation({ round: 2 });

    await expect(service.startNextRound(ROOM_CODE, 1)).rejects.toThrow(BadRequestError);
  });

  it('refuses to open a Round once the Room is FINISHED', async () => {
    const { service } = await buildRotation({ status: 'FINISHED' });

    await expect(service.startNextRound(ROOM_CODE, 1)).rejects.toThrow(BadRequestError);
  });
});

describe('RoomService.processJudgeChooseWinner phase rules', () => {
  function buildJudging(status: 'PLAYING' | 'JUDGING' = 'JUDGING') {
    return buildService({
      room: makeRoom(),
      players: [judge(), makePlayer({ id: 'player-winner' })],
      rounds: [makeRound({ status })],
      plays: [makePlay('player-winner')]
    });
  }

  const pick = { roomCode: ROOM_CODE, judgePlayerId: 'player-judge', winnerPlayerId: 'player-winner' };

  it('rejects a pick while the Round is still playing', async () => {
    const { service } = await buildJudging('PLAYING');

    await expect(service.processJudgeChooseWinner(pick)).rejects.toThrow(BadRequestError);
  });

  it('rejects a pick from anyone but the Judge', async () => {
    const { service } = await buildJudging();

    await expect(
      service.processJudgeChooseWinner({ ...pick, judgePlayerId: 'player-winner' })
    ).rejects.toThrow(ForbiddenError);
  });

  it('scores once and rejects a repeated pick (double-click)', async () => {
    const { service, store } = await buildJudging();

    await service.processJudgeChooseWinner(pick);
    await expect(service.processJudgeChooseWinner(pick)).rejects.toThrow(BadRequestError);

    const winner = await store.players.getPlayerFromRoom(ROOM_CODE, 'player-winner');
    expect(winner?.score).toBe(1);
    expect((await store.rounds.findById('round-1'))?.status).toBe('COMPLETE');
  });

  it('rejects a winner who did not play this Round', async () => {
    const { service } = await buildJudging();

    await expect(
      service.processJudgeChooseWinner({ ...pick, winnerPlayerId: 'player-judge' })
    ).rejects.toThrow(BadRequestError);
  });
});

describe('RoomService.playCards rules', () => {
  const hand = ['w1', 'w2', 'w3'];

  function buildPlay(pick: number) {
    return buildService({
      room: makeRoom(),
      players: [judge(), makePlayer({ id: 'player-a', cardIds: hand })],
      rounds: [makeRound()],
      blackCards: [{ id: 'black-1', text: 'prompt', pick, packId: 'p' }]
    });
  }

  it('records the play in order and marks the Player as played', async () => {
    const { service, store } = await buildPlay(2);

    const { player, cardsDrawn } = await service.playCards(ROOM_CODE, 'player-a', ['w3', 'w1']);

    const [play] = await store.playedCards.findByRoomCodeAndRoundNumber(ROOM_CODE, 1);
    expect(play.whiteCards.map(card => card.id)).toEqual(['w3', 'w1']);
    expect(player.isReady).toBe(true);
    expect(cardsDrawn).toHaveLength(2);
  });

  it("rejects a count that does not match the Black Card's pick", async () => {
    const { service } = await buildPlay(2);

    await expect(service.playCards(ROOM_CODE, 'player-a', ['w1'])).rejects.toThrow('pede 2');
  });

  it('rejects the Judge playing', async () => {
    const { service } = await buildPlay(1);

    await expect(service.playCards(ROOM_CODE, 'player-judge', ['w1'])).rejects.toThrow(ForbiddenError);
  });

  it('rejects a play once the Room is no longer in progress', async () => {
    const { service } = await buildService({
      room: makeRoom({ status: 'FINISHED' }),
      players: [makePlayer({ id: 'player-a', cardIds: hand })],
      rounds: [makeRound()],
    });

    await expect(service.playCards(ROOM_CODE, 'player-a', ['w1'])).rejects.toThrow(BadRequestError);
  });
});

describe('RoomService.endGame stops the Round clock', () => {
  it('aborts the in-flight Round so its timers become no-ops', async () => {
    const { service, store } = await buildService({
      room: makeRoom(),
      players: [judge()],
      rounds: [makeRound({ status: 'PLAYING' })],
    });

    await service.endGame(ROOM_CODE);

    expect((await store.rounds.findById('round-1'))?.status).toBe('ABORTED');
  });
});

describe('RoomService.startGame', () => {
  function buildLobby(guestReady = true) {
    return buildService({
      room: makeRoom({ status: 'LOBBY', round: 0, hostId: 'host', judgeId: null }),
      players: [
        makePlayer({ id: 'host', isHost: true, isReady: true }),
        makePlayer({ id: 'guest-a', isReady: guestReady }),
        makePlayer({ id: 'guest-b', isReady: true })
      ],
      rounds: [],
    });
  }

  it('opens Round 1 with a Judge, a Black Card and a dealt Hand per Player', async () => {
    const { service, store } = await buildLobby();

    const start = await service.startGame(ROOM_CODE, 'host');

    expect(start.room.status).toBe('IN_PROGRESS');
    expect(start.room.round).toBe(1);
    expect(start.round).toEqual(expect.objectContaining({ roundNumber: 1, status: 'PLAYING' }));
    expect(start.round.judgeId).toBe(start.room.judgeId);
    expect(start.hands.map(hand => hand.cards.length)).toEqual([10, 10, 10]);
    const players = await store.players.getRoomPlayersByCode(ROOM_CODE);
    expect(players.every(player => !player.isReady)).toBe(true);
  });

  it('refuses to start until every Player is ready', async () => {
    const { service } = await buildLobby(false);

    await expect(service.startGame(ROOM_CODE, 'host')).rejects.toThrow(BadRequestError);
  });

  it('refuses a start from a non-Host', async () => {
    const { service } = await buildLobby();

    await expect(service.startGame(ROOM_CODE, 'guest-a')).rejects.toThrow(BadRequestError);
  });
});

describe('RoomService.togglePlayerReady', () => {
  it('toggles in the LOBBY', async () => {
    const { service } = await buildService({
      room: makeRoom({ status: 'LOBBY' }),
      players: [makePlayer({ id: 'player-a' })],
      rounds: [],
    });

    const player = await service.togglePlayerReady(ROOM_CODE, 'player-a');

    expect(player.isReady).toBe(true);
  });

  it('is rejected mid-game, where isReady means "played this Round"', async () => {
    const { service } = await buildService({
      room: makeRoom({ status: 'IN_PROGRESS' }),
      players: [makePlayer({ id: 'player-a', isReady: true })],
      rounds: [],
    });

    await expect(service.togglePlayerReady(ROOM_CODE, 'player-a')).rejects.toThrow(BadRequestError);
  });
});

describe('RoomService.joinRoom', () => {
  it('rejects joining a FINISHED Room', async () => {
    const { service } = await buildService({
      room: makeRoom({ status: 'FINISHED' }),
      players: [],
      rounds: [],
    });

    await expect(
      service.joinRoom({ roomCode: ROOM_CODE, password: null, player: makePlayer() })
    ).rejects.toThrow(BadRequestError);
  });
});

describe('RoomService.getRoundSnapshot', () => {
  it('hides Played Cards until the Round reaches judging', async () => {
    const { service } = await buildService({
      room: makeRoom(),
      players: [judge(), makePlayer({ id: 'player-a' })],
      rounds: [makeRound({ status: 'PLAYING' })],
      plays: [makePlay('player-a')]
    });

    const snapshot = await service.getRoundSnapshot(ROOM_CODE);

    expect(snapshot).toEqual(
      expect.objectContaining({ roundNumber: 1, status: 'PLAYING', roundPlayedCards: [] })
    );
  });

  it('reveals Played Cards during judging', async () => {
    const { service } = await buildService({
      room: makeRoom(),
      players: [judge(), makePlayer({ id: 'player-a' })],
      rounds: [makeRound({ status: 'JUDGING' })],
      plays: [makePlay('player-a')]
    });

    const snapshot = await service.getRoundSnapshot(ROOM_CODE);

    expect(snapshot?.roundPlayedCards).toHaveLength(1);
  });
});

// isJudge is derived from the Room, so after a rotation the outgoing Judge must
// play and the incoming one is no longer awaited. A stored flag got this wrong.
describe('RoomService "everyone has played" across a Judge rotation', () => {
  const ids = ['player-judge', 'player-a', 'player-b'];

  it('awaits the outgoing Judge, skips the new one, then reports all played', async () => {
    const { service } = await buildService({
      room: makeRoom({ judgeId: 'player-judge' }),
      players: ids.map(id => makePlayer({ id, cardIds: [`${id}-card`] })),
      rounds: [makeRound({ status: 'COMPLETE' })]
    });

    const next = await service.startNextRound(ROOM_CODE, 1);
    const contenders = ids.filter(id => id !== next.judgeId);
    for (const id of contenders) {
      expect(await service.allActivePlayersPlayed(ROOM_CODE)).toBe(false);
      await service.playCards(ROOM_CODE, id, [`${id}-card`]);
    }

    expect(contenders).toContain('player-judge');
    expect(await service.allActivePlayersPlayed(ROOM_CODE)).toBe(true);
    const plays = await service.getRoundPlayedCards(ROOM_CODE, 2);
    expect(plays.map(play => play.player.id).sort()).toEqual(contenders.sort());
  });
});
