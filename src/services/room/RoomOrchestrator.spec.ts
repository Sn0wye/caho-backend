import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import type { JoinRoomDTO } from '@/dto/JoinRoom';
import { BadRequestError } from '@/errors';
import type { Player, Ranking, Room, RoomPlayer, Round } from '@/schemas';
import { FakeGameEventPublisher } from '@/services/IGameEventPublisher.fakes';
import type { HostLossOutcome } from './IRoomService';
import {
  FakeJudgeClock,
  FakeRoomOrchestratorService,
  type RoomOrchestratorState
} from './RoomOrchestrator.fakes';
import { RoomOrchestrator } from './RoomOrchestrator';
import { describe, expect, it } from 'vitest';

const ROOM_CODE = 'ABC123';
const HOST_ID = 'host';
const JUDGE_ID = 'player-judge';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-a',
    username: 'player-a',
    avatarUrl: null,
    isHost: false,
    isReady: false,
    isJudge: false,
    isActive: true,
    score: 0,
    cardIds: [],
    ...overrides
  };
}

// What a room.* player payload carries after the private Hand (cardIds) and the
// derived isJudge are stripped from a Player. ADR-0005.
function makeRoomPlayer(overrides: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    id: 'player-a',
    username: 'player-a',
    avatarUrl: null,
    isHost: false,
    isReady: false,
    isActive: true,
    score: 0,
    ...overrides
  };
}

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    code: ROOM_CODE,
    maxPlayers: 8,
    maxPoints: 5,
    status: 'IN_PROGRESS',
    hostId: HOST_ID,
    password: null,
    isPublic: true,
    prevJudgeId: null,
    judgeId: JUDGE_ID,
    round: 2,
    pickedWhiteCards: [],
    pickedBlackCards: [],
    currentBlackCardId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function makeRound(): Round {
  return {
    id: 'round-2',
    roomCode: ROOM_CODE,
    roundNumber: 2,
    blackCardId: 'black-1',
    judgeId: JUDGE_ID,
    roundWinnerId: null,
    status: 'PLAYING',
    playDeadline: null,
    judgeDeadline: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

const NOT_HOST: HostLossOutcome = { kind: 'not-host' };

type Harness = {
  output: FakeConsoleOutput;
  orchestrator: RoomOrchestrator;
  rooms: FakeRoomOrchestratorService;
  clock: FakeJudgeClock;
  publisher: FakeGameEventPublisher;
};

function build(state: Partial<RoomOrchestratorState>): Harness {
  const rooms = new FakeRoomOrchestratorService(state);
  const clock = new FakeJudgeClock();
  const publisher = new FakeGameEventPublisher();
  const output = new FakeConsoleOutput();
  const { logger } = buildLogger({ consoleOutput: output });
  return {
    output,
    orchestrator: new RoomOrchestrator(rooms, clock, publisher, logger),
    rooms,
    clock,
    publisher
  };
}

describe('RoomOrchestrator.joinRoom', () => {
  it('adds the Player and announces the join', async () => {
    const room = makeRoom({ status: 'LOBBY' });
    const { orchestrator, rooms, publisher } = build({ room });
    const input: JoinRoomDTO = {
      roomCode: ROOM_CODE,
      password: null,
      player: makePlayer()
    };

    const result = await orchestrator.joinRoom(input);

    expect(result).toBe(room);
    expect(rooms.joined).toEqual([input]);
    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: { event: 'room.player-joined', payload: makeRoomPlayer() }
      }
    ]);
  });
});

describe('RoomOrchestrator.joinRoom mid-game', () => {
  it('deals a late joiner a Hand on their private channel', async () => {
    const hand = [{ id: 'w1', text: 'white', packId: 'p' }];
    const { orchestrator, rooms, publisher } = build({
      room: makeRoom({ status: 'IN_PROGRESS' }),
      dealtHand: hand
    });

    await orchestrator.joinRoom({ roomCode: ROOM_CODE, password: null, player: makePlayer() });

    expect(rooms.dealHandCalls).toEqual([
      { roomCode: ROOM_CODE, playerId: 'player-a', count: 10 }
    ]);
    expect(publisher.published.at(-1)).toEqual({
      channel: 'player-a',
      event: { event: 'player.cards-drawn', payload: hand }
    });
  });
});

describe('RoomOrchestrator.startRoom', () => {
  it('broadcasts the sanitized start, sends each Hand privately, arms Round 1 and announces it', async () => {
    const blackCard = { id: 'b1', text: 'black', pick: 1, packId: 'p' };
    const hand = [{ id: 'w1', text: 'white', packId: 'p' }];
    const host = makePlayer({ id: HOST_ID, isHost: true });
    const { orchestrator, clock, publisher } = build({
      gameStart: {
        room: makeRoom({ password: 'secret', round: 1 }),
        players: [host],
        round: { ...makeRound(), id: 'round-1', roundNumber: 1 },
        blackCard,
        hands: [{ playerId: HOST_ID, cards: hand }]
      }
    });

    await orchestrator.startRoom(ROOM_CODE, HOST_ID);

    const [started, cards, roundStart] = publisher.published;
    expect(started.event.event).toBe('room.started');
    expect(JSON.stringify(started.event.payload)).not.toContain('secret');
    expect(cards).toEqual({
      channel: HOST_ID,
      event: { event: 'player.cards-drawn', payload: hand }
    });
    expect(clock.armedPlayRoundIds).toEqual(['round-1']);
    expect(roundStart.event).toEqual({
      event: 'room.round-start',
      payload: { roundNumber: 1, judgeId: JUDGE_ID, blackCard }
    });
  });
});

describe('RoomOrchestrator.markPresence reconnect', () => {
  it('releases the held Round when the dropped Judge reconnects', async () => {
    const { orchestrator, clock } = build({
      room: makeRoom(),
      presencePlayer: makePlayer({ id: JUDGE_ID }),
      activeRound: makeRound()
    });

    await orchestrator.markPresence(ROOM_CODE, JUDGE_ID, true);

    expect(clock.returnedRoundIds).toEqual(['round-2']);
  });

  it('does not touch the clock when a non-Judge reconnects', async () => {
    const { orchestrator, clock } = build({
      room: makeRoom(),
      presencePlayer: makePlayer(),
      activeRound: makeRound()
    });

    await orchestrator.markPresence(ROOM_CODE, 'player-a', true);

    expect(clock.returnedRoundIds).toHaveLength(0);
  });
});

describe('RoomOrchestrator.leaveRoom', () => {
  it('removes the Player and announces the leave with no fallout for a non-Host non-Judge', async () => {
    const { orchestrator, rooms, clock, publisher } = build({
      room: makeRoom(),
      hostLoss: NOT_HOST
    });

    await orchestrator.leaveRoom(ROOM_CODE, 'player-a');

    expect(rooms.left).toEqual([{ roomCode: ROOM_CODE, playerId: 'player-a' }]);
    expect(publisher.published).toEqual([
      { channel: ROOM_CODE, event: { event: 'room.player-left', payload: { id: 'player-a' } } }
    ]);
    expect(clock.expiredRoundIds).toHaveLength(0);
  });

  it('reassigns the Host when the Host leaves', async () => {
    const newHost = makePlayer({ id: 'heir', isHost: true });
    const { orchestrator, publisher } = build({
      room: makeRoom({ judgeId: 'someone-else' }),
      hostLoss: { kind: 'host-reassigned', newHost }
    });

    await orchestrator.leaveRoom(ROOM_CODE, HOST_ID);

    expect(publisher.published).toEqual([
      { channel: ROOM_CODE, event: { event: 'room.player-left', payload: { id: HOST_ID } } },
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.player-update',
          payload: makeRoomPlayer({ id: 'heir', isHost: true })
        }
      }
    ]);
  });

  it('aborts and rotates immediately when the departing Player is the Judge', async () => {
    const round = makeRound();
    const { orchestrator, clock } = build({
      room: makeRoom({ judgeId: JUDGE_ID }),
      hostLoss: NOT_HOST,
      activeRound: round
    });

    await orchestrator.leaveRoom(ROOM_CODE, JUDGE_ID);

    expect(clock.expiredRoundIds).toEqual([round.id]);
    expect(clock.gracedRoundIds).toHaveLength(0);
  });
});

describe('RoomOrchestrator.markPresence', () => {
  it('broadcasts the re-activated Player on reconnect with no departure fallout', async () => {
    const { orchestrator, rooms, clock, publisher } = build({
      presencePlayer: makePlayer({ id: JUDGE_ID }),
      room: makeRoom()
    });

    await orchestrator.markPresence(ROOM_CODE, JUDGE_ID, true);

    expect(rooms.setActiveCalls).toEqual([
      { roomCode: ROOM_CODE, playerId: JUDGE_ID, isActive: true }
    ]);
    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.player-update',
          payload: makeRoomPlayer({ id: JUDGE_ID, isActive: true })
        }
      }
    ]);
    expect(clock.gracedRoundIds).toHaveLength(0);
  });

  it('arms the Judge grace timer on a drop of the current Judge', async () => {
    const round = makeRound();
    const { orchestrator, clock } = build({
      presencePlayer: makePlayer({ id: JUDGE_ID }),
      room: makeRoom({ judgeId: JUDGE_ID }),
      hostLoss: NOT_HOST,
      activeRound: round
    });

    await orchestrator.markPresence(ROOM_CODE, JUDGE_ID, false);

    expect(clock.gracedRoundIds).toEqual([round.id]);
    expect(clock.expiredRoundIds).toHaveLength(0);
  });

  // Regression: a Host refresh in LOBBY closed the socket and ended the Room.
  it('keeps the Room and its Host when the Host drops in LOBBY', async () => {
    const { orchestrator, rooms, publisher } = build({
      presencePlayer: makePlayer({ id: HOST_ID, isHost: true }),
      room: makeRoom({ status: 'LOBBY', judgeId: null }),
      hostLoss: { kind: 'room-ended', ranking: [] }
    });

    await orchestrator.markPresence(ROOM_CODE, HOST_ID, false);

    expect(rooms.hostLossCalls).toHaveLength(0);
    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.player-update',
          payload: makeRoomPlayer({ id: HOST_ID, isHost: true, isActive: false })
        }
      }
    ]);
  });

  it('still hands Host over when the Host drops IN_PROGRESS', async () => {
    const newHost = makePlayer({ id: 'player-a', isHost: true });
    const { orchestrator, rooms } = build({
      presencePlayer: makePlayer({ id: HOST_ID, isHost: true }),
      room: makeRoom(),
      hostLoss: { kind: 'host-reassigned', newHost }
    });

    await orchestrator.markPresence(ROOM_CODE, HOST_ID, false);

    expect(rooms.hostLossCalls).toEqual([HOST_ID]);
  });
});

describe('RoomOrchestrator.endRoom', () => {
  it('ends the game and broadcasts the final Ranking for the Host', async () => {
    const ranking: Ranking = [
      { id: HOST_ID, username: 'host', avatarUrl: null, score: 5 }
    ];
    const { orchestrator, rooms, publisher } = build({
      room: makeRoom(),
      ranking
    });

    const result = await orchestrator.endRoom(ROOM_CODE, HOST_ID);

    expect(result).toBe(ranking);
    expect(rooms.endGameCalls).toEqual([ROOM_CODE]);
    expect(publisher.published).toEqual([
      { channel: ROOM_CODE, event: { event: 'room.game-end', payload: ranking } }
    ]);
  });

  it('rejects a non-Host and does not end the game', async () => {
    const { orchestrator, rooms } = build({ room: makeRoom() });

    await expect(orchestrator.endRoom(ROOM_CODE, 'intruder')).rejects.toThrow(
      BadRequestError
    );
    expect(rooms.endGameCalls).toHaveLength(0);
  });
});


describe('Room lifecycle logging', () => {
  it('records membership changes without the password or private Hand', async () => {
    const { orchestrator, output } = build({ room: makeRoom({ status: 'LOBBY', password: 'private-password' }) });
    await orchestrator.joinRoom({ roomCode: ROOM_CODE, password: 'private-password', player: makePlayer({ cardIds: ['private-card'] }) });
    expect(JSON.parse(output.lines[0])).toMatchObject({ event: 'room.player_joined', roomCode: ROOM_CODE, playerId: 'player-a' });
    expect(output.lines.join('')).not.toMatch(/private-/);
  });
});
