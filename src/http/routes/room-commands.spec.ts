import { type TestApp, buildTestApp, signedInAs } from '@/app.fakes';
import {
  ROOM_CODE,
  findPlayer,
  makePlayedCards,
  makePlayer,
  makeRoom,
  makeRound
} from '@/services/room/RoomService.fixtures';
import { afterEach, describe, expect, it } from 'vitest';

// Room commands through the whole app as a signed-in User. Rules live in the
// RoomOrchestrator / RoundLifecycle specs; here we check each route reaches
// them and answers with the right status and shape. issue #26.

const HOST_ID = 'host';
const JUDGE_ID = 'player-judge';

let harness: TestApp;
afterEach(async () => {
  await harness.app.close();
});

function post(path: string, userId: string, payload?: object) {
  return harness.app.inject({ method: 'POST', url: `/rooms${path}`, headers: signedInAs(userId), payload });
}

function lobby(players = [makePlayer({ id: HOST_ID, isHost: true })]) {
  return {
    room: makeRoom({ status: 'LOBBY' as const, round: 0, hostId: HOST_ID, judgeId: null, password: 'secret' }),
    players
  };
}

function midGame() {
  return {
    room: makeRoom({ hostId: HOST_ID, judgeId: JUDGE_ID }),
    players: [
      makePlayer({ id: HOST_ID, isHost: true, cardIds: ['host-1'] }),
      makePlayer({ id: JUDGE_ID }),
      makePlayer({ id: 'player-a', cardIds: ['a-1'] })
    ],
    rounds: [makeRound()]
  };
}

describe('POST /rooms/create and /rooms/join', () => {
  it('seat the creator and a joiner as the same Player shape, with no password in either reply', async () => {
    harness = await buildTestApp({ room: makeRoom({ code: 'OTHER1' }) }, ['creator', 'joiner']);
    const settings = { maxPlayers: 4, maxPoints: 5, password: 'secret' };

    const created = await post('/create', 'creator', settings);
    const { code } = created.json();
    const joined = await post('/join', 'joiner', { roomCode: code, password: 'secret' });

    expect(created.statusCode).toBe(201);
    expect(joined.statusCode).toBe(200);
    for (const reply of [created, joined]) {
      expect(reply.json()).toMatchObject({ code, hostId: 'creator', status: 'LOBBY' });
      expect(reply.json()).toMatchObject({ hasPassword: true });
      expect(reply.body).not.toContain('secret');
    }
    const shape = { avatarUrl: null, score: 0, isReady: false, isJudge: false, isActive: true, cardIds: [] };
    expect(await harness.store.players.getPlayerFromRoom(code, 'creator')).toEqual({ id: 'creator', username: 'creator', isHost: true, ...shape });
    expect(await harness.store.players.getPlayerFromRoom(code, 'joiner')).toEqual({ id: 'joiner', username: 'joiner', isHost: false, ...shape });
  });

  it('rejects a wrong password', async () => {
    harness = await buildTestApp(lobby(), ['joiner']);

    const reply = await post('/join', 'joiner', { roomCode: ROOM_CODE, password: 'wrong' });

    expect(reply.statusCode).toBe(400);
  });

  // Regression: a password only locked a Room when isPublic was false, so a
  // public Room with a password let anyone in. The password alone decides now.
  it('rejects joining a locked Room without a password', async () => {
    harness = await buildTestApp(lobby(), ['joiner']);

    const reply = await post('/join', 'joiner', { roomCode: ROOM_CODE, password: null });

    expect(reply.statusCode).toBe(400);
  });

  it('treats an empty password as no password', async () => {
    harness = await buildTestApp({ room: makeRoom({ code: 'OTHER1' }) }, ['creator', 'joiner']);

    const created = await post('/create', 'creator', { maxPlayers: 4, maxPoints: 5, password: '' });
    const joined = await post('/join', 'joiner', { roomCode: created.json().code, password: null });

    expect(created.json()).toMatchObject({ hasPassword: false });
    expect(joined.statusCode).toBe(200);
  });
});

describe('POST /rooms/start', () => {
  it('starts the game and keeps the password out of room.started', async () => {
    const ready = [HOST_ID, 'player-a', 'player-b'].map(id => makePlayer({ id, isHost: id === HOST_ID, isReady: true }));
    harness = await buildTestApp(lobby(ready));

    const reply = await post('/start', HOST_ID, { roomCode: ROOM_CODE });

    expect(reply.statusCode).toBe(204);
    const started = harness.bus.published.find(({ event }) => event.event === 'room.started');
    expect(started?.event.payload).toMatchObject({ room: { code: ROOM_CODE, status: 'IN_PROGRESS' } });
    expect(JSON.stringify(started)).not.toContain('secret');
    expect(JSON.stringify(started)).not.toContain('"password"');
  });
});

describe('POST /rooms/:roomCode/ready', () => {
  it('toggles the caller ready flag in the lobby', async () => {
    harness = await buildTestApp(lobby());

    expect((await post(`/${ROOM_CODE}/ready`, HOST_ID)).statusCode).toBe(204);
    expect((await findPlayer(harness.store, HOST_ID))?.isReady).toBe(true);
  });
});

describe('POST /rooms/leave', () => {
  it('removes the caller from the Room', async () => {
    harness = await buildTestApp(midGame());

    expect((await post('/leave', 'player-a', { roomCode: ROOM_CODE })).statusCode).toBe(204);
    expect(await findPlayer(harness.store, 'player-a')).toBeUndefined();
  });
});

describe('POST /rooms/end', () => {
  it('ends the game for the Host and returns the Ranking', async () => {
    harness = await buildTestApp(midGame());

    const reply = await post('/end', HOST_ID, { roomCode: ROOM_CODE });

    expect(reply.statusCode).toBe(200);
    expect(reply.json().map((entry: { id: string }) => entry.id).sort()).toEqual([HOST_ID, JUDGE_ID, 'player-a'].sort());
  });

  it('refuses anyone but the Host', async () => {
    harness = await buildTestApp(midGame());

    expect((await post('/end', 'player-a', { roomCode: ROOM_CODE })).statusCode).toBe(400);
  });
});

describe('POST /rooms/:roomCode/play-cards', () => {
  it('accepts a play from the caller Hand', async () => {
    harness = await buildTestApp(midGame());

    const reply = await post(`/${ROOM_CODE}/play-cards`, 'player-a', ['a-1']);

    expect(reply.statusCode).toBe(204);
    expect((await findPlayer(harness.store, 'player-a'))?.isReady).toBe(true);
  });
});

describe('POST /rooms/:roomCode/winner', () => {
  it('lets the Judge pick a Played Card in judging', async () => {
    harness = await buildTestApp({
      ...midGame(),
      rounds: [makeRound({ status: 'JUDGING' })],
      playedCards: [makePlayedCards('player-a')]
    });

    const reply = await post(`/${ROOM_CODE}/winner`, JUDGE_ID, { winnerPlayerId: 'player-a' });

    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({ success: true });
    expect((await findPlayer(harness.store, 'player-a'))?.score).toBe(1);
  });
});
