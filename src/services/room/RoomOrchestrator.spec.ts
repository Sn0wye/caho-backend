import { BadRequestError } from '@/errors';
import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import type { InMemoryGameStore } from '@/repositories/game-store/InMemoryGameStore';
import {
  type GameSeed,
  makeBlackCard
} from '@/repositories/game-store/gameStore.fixtures';
import type { Player, RoomPlayer } from '@/schemas';
import { FakeGameEventPublisher } from '@/services/IGameEventPublisher.fakes';
import { describe, expect, it } from 'vitest';
import { RoomOrchestrator } from './RoomOrchestrator';
import { FakeJudgeClock } from './RoomOrchestrator.fakes';
import {
  ROOM_CODE,
  buildService,
  makePlayer,
  makeRoom,
  makeRound
} from './RoomService.fixtures';

// RoomOrchestrator over the real RoomService on one InMemoryGameStore. Only the
// Judge clock (RoundTimekeeper's slice, covered by its own spec) and the
// publisher are faked, so membership, Host and Judge fallout come from the
// rules themselves rather than scripted outcomes. See issue #24.

const HOST_ID = 'host';
const JUDGE_ID = 'player-judge';

type Harness = {
  orchestrator: RoomOrchestrator;
  store: InMemoryGameStore;
  clock: FakeJudgeClock;
  publisher: FakeGameEventPublisher;
  output: FakeConsoleOutput;
};

// A Player whose username matches its id, so payloads read plainly.
function player(id: string, overrides: Partial<Player> = {}): Player {
  return makePlayer({ id, username: id, ...overrides });
}

// Host, Judge and one more Player, mid-game in Round 1.
function gameSeed(overrides: Partial<GameSeed> = {}): GameSeed {
  return {
    room: makeRoom({ hostId: HOST_ID, judgeId: JUDGE_ID }),
    players: [
      player(HOST_ID, { isHost: true }),
      player(JUDGE_ID),
      player('player-a')
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
  const clock = new FakeJudgeClock();
  const publisher = new FakeGameEventPublisher();
  const output = new FakeConsoleOutput();
  const { logger } = buildLogger({ consoleOutput: output });
  const orchestrator = new RoomOrchestrator(service, clock, publisher, logger);
  return { orchestrator, store, clock, publisher, output };
}

// What a room.* Player payload carries: no Hand, no isJudge (ADR-0005).
// Written out so it can't mirror toRoomPlayer.
function roomPlayer(
  id: string,
  overrides: Partial<RoomPlayer> = {}
): RoomPlayer {
  return {
    id,
    username: id,
    avatarUrl: null,
    isHost: false,
    isReady: false,
    isActive: true,
    score: 0,
    ...overrides
  };
}

async function playerIn(
  store: InMemoryGameStore,
  id: string
): Promise<Player | undefined> {
  return await store.players.getPlayerFromRoom(ROOM_CODE, id);
}

describe('RoomOrchestrator.joinRoom', () => {
  it('adds the Player and announces the join', async () => {
    const { orchestrator, store, publisher } = await build(lobbySeed());

    const room = await orchestrator.joinRoom({
      roomCode: ROOM_CODE,
      password: null,
      player: player('newcomer')
    });

    expect(room.code).toBe(ROOM_CODE);
    expect(await playerIn(store, 'newcomer')).toBeDefined();
    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: { event: 'room.player-joined', payload: roomPlayer('newcomer') }
      }
    ]);
  });

  it('deals a late joiner a full Hand on their private channel', async () => {
    const { orchestrator, store, publisher } = await build();

    await orchestrator.joinRoom({
      roomCode: ROOM_CODE,
      password: null,
      player: player('newcomer')
    });

    const hand = (await playerIn(store, 'newcomer'))?.cardIds ?? [];
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
        player: player('newcomer')
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
        player(id, { isHost: id === HOST_ID, isReady: true })
      )
    });
  }

  it('broadcasts the sanitized start, sends each Hand privately, arms Round 1 and announces it', async () => {
    const { orchestrator, store, clock, publisher } = await build(readyLobby());

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
    expect(clock.armedPlayRoundIds).toEqual([round?.id]);
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
    const { orchestrator, clock, publisher } = await build(readyLobby());

    await expect(orchestrator.startRoom(ROOM_CODE, 'player-a')).rejects.toThrow(
      BadRequestError
    );
    expect(publisher.published).toEqual([]);
    expect(clock.armedPlayRoundIds).toEqual([]);
  });
});

describe('RoomOrchestrator.leaveRoom', () => {
  it('removes the Player and announces the leave with no fallout for a non-Host non-Judge', async () => {
    const { orchestrator, store, clock, publisher } = await build();

    await orchestrator.leaveRoom(ROOM_CODE, 'player-a');

    expect(await playerIn(store, 'player-a')).toBeUndefined();
    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: { event: 'room.player-left', payload: { id: 'player-a' } }
      }
    ]);
    expect(clock.expiredRoundIds).toHaveLength(0);
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
          payload: roomPlayer(room?.hostId ?? '', { isHost: true })
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
    const { orchestrator, clock } = await build();

    await orchestrator.leaveRoom(ROOM_CODE, JUDGE_ID);

    expect(clock.expiredRoundIds).toEqual(['round-1']);
    expect(clock.gracedRoundIds).toHaveLength(0);
  });
});

describe('RoomOrchestrator.markPresence', () => {
  it('broadcasts the re-activated Player on reconnect with no departure fallout', async () => {
    const seed = gameSeed();
    seed.players = [
      player(HOST_ID, { isHost: true }),
      player(JUDGE_ID, { isActive: false })
    ];
    const { orchestrator, store, clock, publisher } = await build(seed);

    await orchestrator.markPresence(ROOM_CODE, JUDGE_ID, true);

    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: { event: 'room.player-update', payload: roomPlayer(JUDGE_ID) }
      }
    ]);
    expect((await playerIn(store, JUDGE_ID))?.isActive).toBe(true);
    expect(clock.gracedRoundIds).toHaveLength(0);
  });

  it('releases the held Round when the dropped Judge reconnects', async () => {
    const { orchestrator, clock } = await build();

    await orchestrator.markPresence(ROOM_CODE, JUDGE_ID, true);

    expect(clock.returnedRoundIds).toEqual(['round-1']);
  });

  it('does not touch the clock when a non-Judge reconnects', async () => {
    const { orchestrator, clock } = await build();

    await orchestrator.markPresence(ROOM_CODE, 'player-a', true);

    expect(clock.returnedRoundIds).toHaveLength(0);
  });

  it('arms the Judge grace timer on a drop of the current Judge', async () => {
    const { orchestrator, store, clock } = await build();

    await orchestrator.markPresence(ROOM_CODE, JUDGE_ID, false);

    expect(clock.gracedRoundIds).toEqual(['round-1']);
    expect(clock.expiredRoundIds).toHaveLength(0);
    expect((await playerIn(store, JUDGE_ID))?.isActive).toBe(false);
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
          payload: roomPlayer(HOST_ID, { isHost: true, isActive: false })
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
    expect((await playerIn(store, room?.hostId ?? ''))?.isHost).toBe(true);
    expect((await playerIn(store, HOST_ID))?.isHost).toBe(false);
  });
});

describe('RoomOrchestrator.endRoom', () => {
  it('ends the game and broadcasts the final Ranking for the Host', async () => {
    const seed = gameSeed();
    seed.players = [
      player(HOST_ID, { isHost: true, score: 1 }),
      player(JUDGE_ID, { score: 3 })
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
      player: player('newcomer', { cardIds: ['private-card'] })
    });

    expect(JSON.parse(output.lines[0])).toMatchObject({
      event: 'room.player_joined',
      roomCode: ROOM_CODE,
      playerId: 'newcomer'
    });
    expect(output.lines.join('')).not.toMatch(/private-/);
  });
});
