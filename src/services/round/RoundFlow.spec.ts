import type {
  BlackCard,
  Player,
  Ranking,
  Room,
  RoomPlayer,
  Round,
  RoundPlayedCard,
  RoundWithRelations,
  WhiteCard
} from '@/schemas';
import type { JudgePickResult } from '@/services/room/IRoomService';
import { BadRequestError } from '@/errors';
import { describe, expect, it } from 'vitest';
import {
  FakeGameEventPublisher,
  FakeRoundClock,
  FakeRoundFlowService,
  type RoundFlowServiceState
} from './RoundFlow.fakes';
import { RoundFlow } from './RoundFlow';

const ROOM_CODE = 'ABC123';
const PLAYER_ID = 'player-a';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: PLAYER_ID,
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

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    code: ROOM_CODE,
    maxPlayers: 8,
    maxPoints: 5,
    status: 'IN_PROGRESS',
    hostId: 'host',
    password: null,
    isPublic: true,
    prevJudgeId: null,
    judgeId: 'player-judge',
    round: 2,
    pickedWhiteCards: [],
    pickedBlackCards: [],
    currentBlackCardId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: 'round-2',
    roomCode: ROOM_CODE,
    roundNumber: 2,
    blackCardId: 'black-1',
    judgeId: 'player-judge',
    roundWinnerId: null,
    status: 'PLAYING',
    playDeadline: null,
    judgeDeadline: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// Room-channel view of makePlayer: what a room.player-update actually carries
// after the private Hand (cardIds) and derived isJudge are stripped. ADR-0005.
function makeRoomPlayer(overrides: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    id: PLAYER_ID,
    username: 'player-a',
    avatarUrl: null,
    isHost: false,
    isReady: false,
    isActive: true,
    score: 0,
    ...overrides
  };
}

const WHITE_CARD: WhiteCard = { id: 'wc-1', text: 'a white card', packId: 'p' };
const BLACK_CARD: BlackCard = { text: 'a black card', pick: 1, packId: 'p' };

function makePlayedCard(winnerId: string): RoundPlayedCard {
  return {
    id: 'played-1',
    roundId: 'round-2',
    player: {
      id: winnerId,
      name: winnerId,
      email: null,
      username: winnerId,
      password: 'x',
      avatarUrl: null
    },
    whiteCards: [WHITE_CARD],
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function makeNextRound(): RoundWithRelations & { blackCard: BlackCard } {
  const round = makeRound({ id: 'round-3', roundNumber: 3 });
  return {
    ...round,
    room: makeRoom({ round: 3 }),
    judge: makePlayer({ id: 'player-judge', isJudge: true }),
    roundWinner: null,
    roundPlayedCards: [],
    blackCard: BLACK_CARD
  };
}

function makeJudgeResult(overrides: Partial<JudgePickResult> = {}): JudgePickResult {
  return {
    room: makeRoom(),
    winner: makePlayedCard(PLAYER_ID),
    winnerPlayer: makePlayer({ score: 1 }),
    gameEnded: false,
    ranking: null,
    ...overrides
  };
}

type Harness = {
  flow: RoundFlow;
  rooms: FakeRoundFlowService;
  clock: FakeRoundClock;
  publisher: FakeGameEventPublisher;
};

function buildFlow(
  state: Partial<RoundFlowServiceState>,
  didAdvance = true
): Harness {
  const rooms = new FakeRoundFlowService(state);
  const clock = new FakeRoundClock(didAdvance);
  const publisher = new FakeGameEventPublisher();
  return { flow: new RoundFlow(rooms, clock, publisher), rooms, clock, publisher };
}

describe('RoundFlow.playCards', () => {
  it('broadcasts the ready flag and the refilled Hand, and does not advance when others are still playing', async () => {
    const { flow, clock, publisher, rooms } = buildFlow({
      player: makePlayer(),
      cardsDrawn: [WHITE_CARD],
      allPlayed: false
    });

    await flow.playCards(ROOM_CODE, PLAYER_ID, ['c1']);

    expect(rooms.playCardsCalls).toEqual([
      { roomCode: ROOM_CODE, playerId: PLAYER_ID, playedCardIds: ['c1'] }
    ]);
    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.player-update',
          payload: makeRoomPlayer({ isReady: true })
        }
      },
      {
        channel: PLAYER_ID,
        event: { event: 'player.cards-drawn', payload: [WHITE_CARD] }
      }
    ]);
    expect(clock.advanced).toHaveLength(0);
  });

  it('advances to judging once every active Player has played', async () => {
    const round = makeRound();
    const plays = [makePlayedCard(PLAYER_ID)];
    const { flow, clock } = buildFlow({
      player: makePlayer(),
      cardsDrawn: [WHITE_CARD],
      allPlayed: true,
      activeRound: round,
      plays
    });

    await flow.playCards(ROOM_CODE, PLAYER_ID, ['c1']);

    expect(clock.advanced).toEqual([{ round, plays }]);
  });

  it('rejects a second play in the same Round', async () => {
    const { flow } = buildFlow({ player: makePlayer({ isReady: true }) });

    await expect(flow.playCards(ROOM_CODE, PLAYER_ID, ['c1'])).rejects.toThrow(
      BadRequestError
    );
  });

  it('rejects an empty play', async () => {
    const { flow } = buildFlow({ player: makePlayer() });

    await expect(flow.playCards(ROOM_CODE, PLAYER_ID, [])).rejects.toThrow(
      'Você precisa jogar pelo menos uma carta.'
    );
  });
});

describe('RoundFlow.judgePick', () => {
  it('broadcasts one self-contained round end with the winner score, then starts and arms the next Round', async () => {
    const winner = makePlayedCard(PLAYER_ID);
    const winnerPlayer = makePlayer({ score: 1 });
    const nextRound = makeNextRound();
    const { flow, clock, publisher, rooms } = buildFlow({
      judgeResult: makeJudgeResult({ winner, winnerPlayer }),
      nextRound
    });

    await flow.judgePick(ROOM_CODE, 'player-judge', PLAYER_ID);

    expect(rooms.judgeCalls).toEqual([
      { roomCode: ROOM_CODE, judgePlayerId: 'player-judge', winnerPlayerId: PLAYER_ID }
    ]);
    expect(clock.armed).toEqual([nextRound.id]);
    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.round-end',
          payload: {
            roundNumber: 2,
            winner,
            winnerId: PLAYER_ID,
            newScore: 1,
            reason: 'picked'
          }
        }
      },
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.round-start',
          payload: { roundNumber: 3, judgeId: 'player-judge', blackCard: BLACK_CARD }
        }
      }
    ]);
  });

  it('ends the game instead of starting a Round when the win-condition is met', async () => {
    const ranking: Ranking = [
      { id: PLAYER_ID, username: 'player-a', avatarUrl: null, score: 5 }
    ];
    const { flow, clock, publisher } = buildFlow({
      judgeResult: makeJudgeResult({ gameEnded: true, ranking })
    });

    await flow.judgePick(ROOM_CODE, 'player-judge', PLAYER_ID);

    expect(clock.armed).toHaveLength(0);
    expect(publisher.published.at(-1)).toEqual({
      channel: ROOM_CODE,
      event: { event: 'room.game-end', payload: ranking }
    });
  });
});

describe('RoundFlow.playerReady', () => {
  it('toggles the ready flag and broadcasts the Player update', async () => {
    const { flow, publisher, rooms } = buildFlow({ player: makePlayer() });

    await flow.playerReady(ROOM_CODE, PLAYER_ID);

    expect(rooms.updatePlayerCalls).toEqual([
      { roomCode: ROOM_CODE, playerId: PLAYER_ID, payload: { isReady: true } }
    ]);
    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.player-update',
          payload: makeRoomPlayer({ isReady: true })
        }
      }
    ]);
  });
});
