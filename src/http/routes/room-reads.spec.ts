import { buildTestApp, signedInAs } from '@/app.fakes';
import type { App } from '@/app';
import { makeWhiteCard } from '@/repositories/game-store/gameStore.fixtures';
import type { RoomPlayer, Round } from '@/schemas';
import {
  ROOM_CODE,
  makePlayedCards,
  makePlayer,
  makeRoom,
  makeRound
} from '@/services/room/RoomService.fixtures';
import { afterEach, describe, expect, it } from 'vitest';

// Room reads through the whole app as a signed-in User: auth, validation,
// RoomView and the response schemas together. issue #26 (and #27 for /players).

const CALLER_ID = 'player-caller';
const JUDGE_ID = 'player-judge';
const OUTSIDER_ID = 'outsider';
const CALLER_HAND = ['caller-1', 'caller-2'];

let app: App;
afterEach(async () => {
  await app.close();
});

// The caller and the Judge (also Host) mid-game, each with a distinct Hand,
// the caller having played. Password set, so a leak shows.
async function openGame(status: Round['status'] = 'PLAYING'): Promise<App> {
  ({ app } = await buildTestApp(
    {
      room: makeRoom({ hostId: JUDGE_ID, judgeId: JUDGE_ID, password: 'secret' }),
      players: [
        makePlayer({ id: CALLER_ID, cardIds: CALLER_HAND }),
        makePlayer({ id: JUDGE_ID, isHost: true, isJudge: true, score: 2, cardIds: ['judge-1'] })
      ],
      rounds: [makeRound({ status })],
      playedCards: [makePlayedCards(CALLER_ID)]
    },
    [OUTSIDER_ID]
  ));
  return app;
}

function get(path: string, userId = CALLER_ID) {
  return app.inject({ url: `/rooms${path}`, headers: signedInAs(userId) });
}

describe('GET /rooms/:roomCode/players', () => {
  // Written out so it can't mirror toRoomPlayer.
  const expected: RoomPlayer[] = [
    { id: CALLER_ID, username: CALLER_ID, avatarUrl: null, isHost: false, isReady: false, isActive: true, score: 0 },
    { id: JUDGE_ID, username: JUDGE_ID, avatarUrl: null, isHost: true, isReady: false, isActive: true, score: 2 }
  ];

  it('returns every Player as a RoomPlayer, to members and non-members alike', async () => {
    await openGame();

    for (const viewer of [CALLER_ID, OUTSIDER_ID]) {
      const response = await get(`/${ROOM_CODE}/players`, viewer);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expected);
    }
  });

  // Regression for #27: the raw Player rows exposed every Player's Hand.
  it('never exposes cardIds or isJudge', async () => {
    await openGame();

    const response = await get(`/${ROOM_CODE}/players`);

    expect(response.body).not.toContain('cardIds');
    expect(response.body).not.toContain('isJudge');
  });

  it('rejects an anonymous request', async () => {
    await openGame();

    const response = await app.inject(`/rooms/${ROOM_CODE}/players`);

    expect(response.statusCode).toBe(401);
  });
});

describe('GET /rooms/:roomCode', () => {
  it('returns the Room without its password', async () => {
    await openGame();

    const response = await get(`/${ROOM_CODE}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: ROOM_CODE, judgeId: JUDGE_ID, hasPassword: true });
    expect(response.body).not.toContain('"password"');
    expect(response.body).not.toContain('secret');
  });

  it('answers 404 for an unknown Code', async () => {
    await openGame();

    expect((await get('/ZZZ999')).statusCode).toBe(404);
  });
});

describe('GET /rooms/list', () => {
  it('lists a locked lobby with hasPassword, never the password', async () => {
    ({ app } = await buildTestApp({
      room: makeRoom({ status: 'LOBBY', round: 0, hostId: JUDGE_ID, judgeId: null, password: 'secret' }),
      players: [makePlayer({ id: CALLER_ID }), makePlayer({ id: JUDGE_ID, isHost: true })]
    }));

    const response = await get('/list');

    expect(response.json()).toEqual([
      expect.objectContaining({ code: ROOM_CODE, hostUsername: JUDGE_ID, playerCount: 2, hasPassword: true })
    ]);
    expect(response.body).not.toContain('secret');
  });
});

describe('GET /rooms/:roomCode/white-cards', () => {
  it('returns only the caller own Hand', async () => {
    await openGame();

    const response = await get(`/${ROOM_CODE}/white-cards`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(CALLER_HAND.map(makeWhiteCard));
  });

  it('refuses a non-member', async () => {
    await openGame();

    expect((await get(`/${ROOM_CODE}/white-cards`, OUTSIDER_ID)).statusCode).toBe(403);
  });
});

describe('GET /rooms/:roomCode/round-played-cards', () => {
  it('shows nobody the Played Cards during PLAYING, the Judge included', async () => {
    await openGame('PLAYING');

    for (const viewer of [CALLER_ID, JUDGE_ID]) {
      const response = await get(`/${ROOM_CODE}/round-played-cards`, viewer);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    }
  });

  it.each(['JUDGING', 'COMPLETE'] as const)('reveals them to every member during %s', async status => {
    await openGame(status);

    for (const viewer of [CALLER_ID, JUDGE_ID]) {
      const response = await get(`/${ROOM_CODE}/round-played-cards`, viewer);
      expect(response.json()).toEqual([
        expect.objectContaining({
          player: { id: CALLER_ID, username: CALLER_ID, avatarUrl: null },
          whiteCards: [makeWhiteCard(`card-${CALLER_ID}`)]
        })
      ]);
    }
  });

  it('refuses a non-member', async () => {
    await openGame('JUDGING');

    expect((await get(`/${ROOM_CODE}/round-played-cards`, OUTSIDER_ID)).statusCode).toBe(403);
  });
});

describe('GET /rooms/:roomCode/round', () => {
  it('hides Played Cards in the snapshot until judging', async () => {
    await openGame('PLAYING');

    const response = await get(`/${ROOM_CODE}/round`);

    expect(response.json()).toMatchObject({ roundNumber: 1, status: 'PLAYING', judgeId: JUDGE_ID, roundPlayedCards: [] });
  });

  it('reveals Played Cards in the snapshot during judging', async () => {
    await openGame('JUDGING');

    const response = await get(`/${ROOM_CODE}/round`);

    expect(response.json().roundPlayedCards).toHaveLength(1);
  });

  it('shows the same Black Card as GET /black-card', async () => {
    await openGame();

    const snapshot = (await get(`/${ROOM_CODE}/round`)).json();
    const blackCard = (await get(`/${ROOM_CODE}/black-card`)).json();

    expect(blackCard).toEqual({ id: 'black-1', text: 'black prompt', pick: 1, packId: 'fake-pack' });
    expect(snapshot.blackCard).toEqual(blackCard);
  });

  it('is null before the game starts', async () => {
    ({ app } = await buildTestApp({
      room: makeRoom({ status: 'LOBBY', round: 0, judgeId: null, currentBlackCardId: null }),
      players: [makePlayer({ id: CALLER_ID })]
    }));

    expect((await get(`/${ROOM_CODE}/round`)).json()).toBeNull();
    expect((await get(`/${ROOM_CODE}/black-card`)).json()).toBeNull();
  });

  it('refuses a non-member', async () => {
    await openGame();

    expect((await get(`/${ROOM_CODE}/round`, OUTSIDER_ID)).statusCode).toBe(403);
  });
});
