import { BadRequestError, ForbiddenError, NotFoundError } from '@/errors';
import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE,
  buildService,
  makePlayer,
  makeRoom,
  makeRound
} from './RoomService.fixtures';

// Regression specs for the gaps that broke the loop past Round 1: plays outside
// their phase and lobby-only rules. Rotation and Judge picks moved to
// RoundLifecycle.spec (#25).

const judge = () => makePlayer({ id: 'player-judge', isJudge: true });

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

    const { player } = await service.playCards(ROOM_CODE, 'player-a', ['w3', 'w1']);

    const [playedCards] = await store.playedCards.findByRoomCodeAndRoundNumber(ROOM_CODE, 1);
    expect(playedCards.whiteCards.map(card => card.id)).toEqual(['w3', 'w1']);
    expect(player.isReady).toBe(true);
  });

  // `player.cards-drawn` replaces the client's Hand, so the result must be the
  // whole refilled Hand, not just the cards drawn to top it up.
  it('returns the whole refilled Hand: the kept cards plus the fresh ones', async () => {
    const { service } = await buildPlay(2);

    const { player, hand: refilled } = await service.playCards(ROOM_CODE, 'player-a', ['w3', 'w1']);

    expect(refilled).toHaveLength(hand.length);
    expect(refilled.map(card => card.id)).toEqual(player.cardIds);
    expect(refilled.map(card => card.id)).toContain('w2');
    expect(refilled.map(card => card.id)).not.toContain('w1');
    expect(refilled.map(card => card.id)).not.toContain('w3');
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

  it('picks the first Judge and Black Card and deals a Hand per Player', async () => {
    const { service, store } = await buildLobby();

    const start = await service.startGame(ROOM_CODE, 'host');

    expect(start.room.status).toBe('IN_PROGRESS');
    expect(start.room.round).toBe(1);
    expect(start.judgeId).toBe(start.room.judgeId);
    expect(start.room.currentBlackCardId).toBe(start.blackCard.id);
    // Round 1 itself is opened by RoundLifecycle (#25).
    expect(await store.rounds.find(ROOM_CODE, 1)).toBeNull();
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

  // Both starts read LOBBY before either wrote; only the conditional claim
  // decides, so the loser can't redraw the Black Card or re-deal.
  it('lets only one of two racing starts through', async () => {
    const { service } = await buildLobby();

    const starts = await Promise.allSettled([
      service.startGame(ROOM_CODE, 'host'),
      service.startGame(ROOM_CODE, 'host')
    ]);

    expect(starts.map(start => start.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = starts.find(start => start.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestError);
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

  it('seats only one of two joins racing for the last seat', async () => {
    const { service, store } = await buildService({
      room: makeRoom({ status: 'LOBBY', maxPlayers: 2 }),
      players: [makePlayer({ id: 'host' })],
      rounds: [],
    });

    const joins = await Promise.allSettled([
      service.joinRoom({ roomCode: ROOM_CODE, password: null, player: makePlayer({ id: 'guest-a' }) }),
      service.joinRoom({ roomCode: ROOM_CODE, password: null, player: makePlayer({ id: 'guest-b' }) })
    ]);

    expect(joins.map(join => join.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await store.players.getRoomPlayersByCode(ROOM_CODE)).toHaveLength(2);
  });

  it('rejects joining a missing Room with NotFoundError', async () => {
    const { service } = await buildService({ room: makeRoom(), players: [], rounds: [] });

    await expect(
      service.joinRoom({ roomCode: 'NOPE00', password: null, player: makePlayer() })
    ).rejects.toThrow(NotFoundError);
  });
});
