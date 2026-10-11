import { BadRequestError } from '@/errors';
import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import type { InMemoryGameStore } from '@/repositories/game-store/InMemoryGameStore';
import {
  type GameSeed,
  makeBlackCard
} from '@/repositories/game-store/gameStore.fixtures';
import { FakeGameEventPublisher } from '@/services/IGameEventPublisher.fakes';
import { RoundLifecycle } from '@/services/round/RoundLifecycle';
import { FakeRoundTimerStore } from '@/services/round/RoundTimerStore.fakes';
import { graceKey, playKey } from '@/services/round/deadlineKeys';
import { describe, expect, it } from 'vitest';
import { BlackCardDeck } from './BlackCardDeck';
import { RoomOrchestrator } from './RoomOrchestrator';
import {
  ROOM_CODE,
  buildService,
  findPlayer,
  makePlayer,
  makeRoom,
  makeRoomPlayer,
  makeRound
} from './RoomService.fixtures';

// RoomOrchestrator over the real RoomService and RoundLifecycle on one
// InMemoryGameStore. Only Redis (the deadline store) and the publisher are
// faked, so membership, Host and Round fallout come from the rules themselves
// rather than scripted outcomes. Round rules live in RoundLifecycle.spec; here
// we check presence and membership reach them. See issues #24, #25.

const HOST_ID = 'host';
const JUDGE_ID = 'player-judge';

type Harness = {
  orchestrator: RoomOrchestrator;
  store: InMemoryGameStore;
  timers: FakeRoundTimerStore;
  publisher: FakeGameEventPublisher;
  output: FakeConsoleOutput;
};

// Host, Judge and one more Player, mid-game in Round 1.
function gameSeed(overrides: Partial<GameSeed> = {}): GameSeed {
  return {
    room: makeRoom({ hostId: HOST_ID, judgeId: JUDGE_ID }),
    players: [
      makePlayer({ id: HOST_ID, isHost: true }),
      makePlayer({ id: JUDGE_ID }),
      makePlayer({ id: 'player-a' })
    ],
    rounds: [makeRound()],
    ...overrides
  };
}

function lobbySeed(overrides: Partial<GameSeed> = {}): GameSeed {
  return gameSeed({
    room: makeRoom({
      status: 'LOBBY',
      round: 0,
      hostId: HOST_ID,
      judgeId: null
    }),
    rounds: [],
    ...overrides
  });
}

async function build(seed: GameSeed = gameSeed()): Promise<Harness> {
  const { service, store } = await buildService(seed);
  const timers = new FakeRoundTimerStore();
  const publisher = new FakeGameEventPublisher();
  const output = new FakeConsoleOutput();
  const { logger } = buildLogger({ consoleOutput: output });
  const rounds = new RoundLifecycle(
    store,
    service,
    new BlackCardDeck(store),
    timers,
    publisher
  );
  const orchestrator = new RoomOrchestrator(service, rounds, publisher, logger);
  return { orchestrator, store, timers, publisher, output };
}

describe('RoomOrchestrator.joinRoom', () => {
  it('adds the Player and announces the join', async () => {
    const { orchestrator, store, publisher } = await build(lobbySeed());

    const room = await orchestrator.joinRoom({
      roomCode: ROOM_CODE,
      password: null,
      player: makePlayer({ id: 'newcomer' })
    });

    expect(room.code).toBe(ROOM_CODE);
    expect(await findPlayer(store, 'newcomer'))?.toBeDefined();
    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.player-joined',
          payload: makeRoomPlayer('newcomer')
        }
      }
    ]);
  });

  it('deals a late joiner a full Hand on their private channel', async () => {
    const { orchestrator, store, publisher } = await build();

    await orchestrator.joinRoom({
      roomCode: ROOM_CODE,
      password: null,
      player: makePlayer({ id: 'newcomer' })
    });

    const hand = (await findPlayer(store, 'newcomer'))?.cardIds ?? [];
    expect(hand).toHaveLength(10);
    const dealt = publisher.published.at(-1);
    expect(dealt?.channel).toBe('newcomer');
    if (dealt?.event.event !== 'player.cards-drawn') {
      throw new Error(
        `Expected player.cards-drawn last, got ${dealt?.event.event}`
      );
    }
    expect(dealt.event.payload.map(card => card.id)).toEqual(hand);
  });

  it('rejects a wrong password and announces nothing', async () => {
    const { orchestrator, publisher } = await build(
      lobbySeed({
        room: makeRoom({
          status: 'LOBBY',
          round: 0,
          hostId: HOST_ID,
          judgeId: null,
          isPublic: false,
          password: 'right'
        })
      })
    );

    await expect(
      orchestrator.joinRoom({
        roomCode: ROOM_CODE,
        password: 'wrong',
        player: makePlayer({ id: 'newcomer' })
      })
    ).rejects.toThrow(BadRequestError);
    expect(publisher.published).toEqual([]);
  });
});

describe('RoomOrchestrator.startRoom', () => {
  function readyLobby(): GameSeed {
    return lobbySeed({
      room: makeRoom({
        status: 'LOBBY',
        round: 0,
        hostId: HOST_ID,
        judgeId: null,
        password: 'secret'
      }),
      players: [HOST_ID, 'player-a', 'player-b'].map(id =>
        makePlayer({ id: id, isHost: id === HOST_ID, isReady: true })
      )
    });
  }

  it('broadcasts the sanitized start, sends each Hand privately, arms Round 1 and announces it', async () => {
    const { orchestrator, store, timers, publisher } = await build(readyLobby());

    await orchestrator.startRoom(ROOM_CODE, HOST_ID);

    const round = await store.rounds.find(ROOM_CODE, 1);
    const room = await store.rooms.getRoomByCode(ROOM_CODE);
    const [started, ...rest] = publisher.published;
    expect(started.event.event).toBe('room.started');
    expect(JSON.stringify(started.event.payload)).not.toContain('secret');
    const hands = rest.filter(
      ({ event }) => event.event === 'player.cards-drawn'
    );
    expect(hands.map(({ channel }) => channel).sort()).toEqual([
      HOST_ID,
      'player-a',
      'player-b'
    ]);
    expect(round?.judgeId).toBe(room?.judgeId);
    expect(timers.armed.get(playKey(round?.id ?? ''))).toBe(60);
    expect(publisher.published.at(-1)?.event).toEqual({
      event: 'room.round-start',
      payload: {
        roundNumber: 1,
        judgeId: room?.judgeId,
        blackCard: makeBlackCard({ id: 'black-1' })
      }
    });
  });

  it('refuses a start from a non-Host and announces nothing', async () => {
    const { orchestrator, timers, publisher } = await build(readyLobby());

    await expect(orchestrator.startRoom(ROOM_CODE, 'player-a')).rejects.toThrow(
      BadRequestError
    );
    expect(publisher.published).toEqual([]);
    expect(timers.armed.size).toBe(0);
  });
});

describe('RoomOrchestrator.leaveRoom', () => {
  it('removes the Player and announces the leave with no fallout for a non-Host non-Judge', async () => {
    const { orchestrator, store, publisher } = await build();

    await orchestrator.leaveRoom(ROOM_CODE, 'player-a');

    expect(await findPlayer(store, 'player-a'))?.toBeUndefined();
    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: { event: 'room.player-left', payload: { id: 'player-a' } }
      }
    ]);
    expect((await store.rounds.findById('round-1'))?.status).toBe('PLAYING');
  });

  it('hands the Host to an active Player when the Host leaves mid-game', async () => {
    const { orchestrator, store, publisher } = await build();

    await orchestrator.leaveRoom(ROOM_CODE, HOST_ID);

    const room = await store.rooms.getRoomByCode(ROOM_CODE);
    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: { event: 'room.player-left', payload: { id: HOST_ID } }
      },
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.player-update',
          payload: makeRoomPlayer(room?.hostId ?? '', { isHost: true })
        }
      }
    ]);
    expect(room?.hostId).not.toBe(HOST_ID);
  });

  it('ends a LOBBY Room when its Host leaves', async () => {
    const { orchestrator, store, publisher } = await build(lobbySeed());

    await orchestrator.leaveRoom(ROOM_CODE, HOST_ID);

    expect(publisher.published.at(-1)?.event.event).toBe('room.game-end');
    expect((await store.rooms.getRoomByCode(ROOM_CODE))?.status).toBe(
      'FINISHED'
    );
  });

  it('aborts and rotates immediately when the departing Player is the Judge', async () => {
    const { orchestrator, store, timers } = await build();

    await orchestrator.leaveRoom(ROOM_CODE, JUDGE_ID);

    expect((await store.rounds.findById('round-1'))?.status).toBe('ABORTED');
    expect((await store.rounds.find(ROOM_CODE, 2))?.judgeId).not.toBe(JUDGE_ID);
    expect(timers.armed.has(graceKey('round-1'))).toBe(false);
  });

  it('aborts the Round when the Host leaves with no active heir', async () => {
    const seed = gameSeed();
    seed.players = [
      makePlayer({ id: HOST_ID, isHost: true }),
      makePlayer({ id: JUDGE_ID, isActive: false })
    ];
    const { orchestrator, store, publisher } = await build(seed);

    await orchestrator.leaveRoom(ROOM_CODE, HOST_ID);

    expect(publisher.published.at(-1)?.event.event).toBe('room.game-end');
    expect((await store.rounds.findById('round-1'))?.status).toBe('ABORTED');
  });
});

describe('RoomOrchestrator.markPresence', () => {
  it('broadcasts the re-activated Player on reconnect with no departure fallout', async () => {
    const seed = gameSeed();
    seed.players = [
      makePlayer({ id: HOST_ID, isHost: true }),
      makePlayer({ id: JUDGE_ID, isActive: false })
    ];
    const { orchestrator, store, timers, publisher } = await build(seed);

    await orchestrator.markPresence(ROOM_CODE, JUDGE_ID, true);

    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.player-update',
          payload: makeRoomPlayer(JUDGE_ID)
        }
      }
    ]);
    expect((await findPlayer(store, JUDGE_ID))?.isActive).toBe(true);
    expect(timers.armed.size).toBe(0);
  });

  it('releases the held Round when the dropped Judge reconnects', async () => {
    const { orchestrator, timers } = await build();
    await orchestrator.markPresence(ROOM_CODE, JUDGE_ID, false);

    await orchestrator.markPresence(ROOM_CODE, JUDGE_ID, true);

    expect(timers.cleared).toEqual([graceKey('round-1')]);
    expect(timers.armed.has(graceKey('round-1'))).toBe(false);
  });

  it('does not touch the clocks when a non-Judge reconnects', async () => {
    const { orchestrator, timers } = await build();

    await orchestrator.markPresence(ROOM_CODE, 'player-a', true);

    expect(timers.cleared).toEqual([]);
  });

  it('arms the Judge grace on a drop of the current Judge, holding the Round', async () => {
    const { orchestrator, store, timers } = await build();

    await orchestrator.markPresence(ROOM_CODE, JUDGE_ID, false);

    expect(timers.armed.get(graceKey('round-1'))).toBe(30);
    expect((await store.rounds.findById('round-1'))?.status).toBe('PLAYING');
    expect((await findPlayer(store, JUDGE_ID))?.isActive).toBe(false);
  });

  it('moves to judging when the last Player owed a play drops', async () => {
    const { orchestrator, store } = await build(
      gameSeed({ playedCards: [{ roundId: 'round-1', playerId: HOST_ID, whiteCardIds: ['w-host'] }] })
    );
    await store.players.updatePlayerInRoom(ROOM_CODE, HOST_ID, { isReady: true });

    await orchestrator.markPresence(ROOM_CODE, 'player-a', false);

    expect((await store.rounds.findById('round-1'))?.status).toBe('JUDGING');
  });

  // Regression: a Host refresh in LOBBY closed the socket and ended the Room.
  it('keeps the Room and its Host when the Host drops in LOBBY', async () => {
    const { orchestrator, store, publisher } = await build(lobbySeed());

    await orchestrator.markPresence(ROOM_CODE, HOST_ID, false);

    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.player-update',
          payload: makeRoomPlayer(HOST_ID, { isHost: true, isActive: false })
        }
      }
    ]);
    const room = await store.rooms.getRoomByCode(ROOM_CODE);
    expect(room).toEqual(
      expect.objectContaining({ status: 'LOBBY', hostId: HOST_ID })
    );
  });

  it('still hands Host over when the Host drops IN_PROGRESS', async () => {
    const { orchestrator, store } = await build();

    await orchestrator.markPresence(ROOM_CODE, HOST_ID, false);

    const room = await store.rooms.getRoomByCode(ROOM_CODE);
    expect(room?.hostId).not.toBe(HOST_ID);
    expect((await findPlayer(store, room?.hostId ?? ''))?.isHost).toBe(true);
    expect((await findPlayer(store, HOST_ID))?.isHost).toBe(false);
  });
});

describe('RoomOrchestrator.playerReady', () => {
  it('toggles the ready flag in the LOBBY and broadcasts the Player update', async () => {
    const { orchestrator, store, publisher } = await build(lobbySeed());

    await orchestrator.playerReady(ROOM_CODE, 'player-a');

    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.player-update',
          payload: makeRoomPlayer('player-a', { isReady: true })
        }
      }
    ]);
    expect((await findPlayer(store, 'player-a'))?.isReady).toBe(true);
  });

  it('rejects the toggle mid-game, where ready means "played this Round"', async () => {
    const { orchestrator, publisher } = await build();

    await expect(orchestrator.playerReady(ROOM_CODE, 'player-a')).rejects.toThrow(
      BadRequestError
    );
    expect(publisher.published).toEqual([]);
  });
});

describe('RoomOrchestrator.endRoom', () => {
  it('ends the game and broadcasts the final Ranking for the Host', async () => {
    const seed = gameSeed();
    seed.players = [
      makePlayer({ id: HOST_ID, isHost: true, score: 1 }),
      makePlayer({ id: JUDGE_ID, score: 3 })
    ];
    const { orchestrator, store, publisher } = await build(seed);

    const ranking = await orchestrator.endRoom(ROOM_CODE, HOST_ID);

    expect(ranking).toEqual([
      { id: JUDGE_ID, username: JUDGE_ID, avatarUrl: null, score: 3 },
      { id: HOST_ID, username: HOST_ID, avatarUrl: null, score: 1 }
    ]);
    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: { event: 'room.game-end', payload: ranking }
      }
    ]);
    expect((await store.rooms.getRoomByCode(ROOM_CODE))?.status).toBe(
      'FINISHED'
    );
    expect((await store.rounds.findById('round-1'))?.status).toBe('ABORTED');
  });

  it('rejects a non-Host and does not end the game', async () => {
    const { orchestrator, store, publisher } = await build();

    await expect(orchestrator.endRoom(ROOM_CODE, 'player-a')).rejects.toThrow(
      BadRequestError
    );
    expect(publisher.published).toEqual([]);
    expect((await store.rooms.getRoomByCode(ROOM_CODE))?.status).toBe(
      'IN_PROGRESS'
    );
  });
});

describe('RoomOrchestrator.playerRoomCodes', () => {
  it('lists the Rooms the Player belongs to', async () => {
    const { orchestrator } = await build();

    expect(await orchestrator.playerRoomCodes('player-a')).toEqual([ROOM_CODE]);
  });
});

describe('Room lifecycle logging', () => {
  it('records membership changes without the password or private Hand', async () => {
    const { orchestrator, output } = await build(
      lobbySeed({
        room: makeRoom({
          status: 'LOBBY',
          round: 0,
          hostId: HOST_ID,
          judgeId: null,
          isPublic: false,
          password: 'private-password'
        })
      })
    );

    await orchestrator.joinRoom({
      roomCode: ROOM_CODE,
      password: 'private-password',
      player: makePlayer({ id: 'newcomer', cardIds: ['private-card'] })
    });

    expect(JSON.parse(output.lines[0])).toMatchObject({
      event: 'room.player_joined',
      roomCode: ROOM_CODE,
      playerId: 'newcomer'
    });
    expect(output.lines.join('')).not.toMatch(/private-/);
  });
});
