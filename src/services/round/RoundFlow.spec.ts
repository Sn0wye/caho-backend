import type { PlayerEvent, RoomEvent } from '@/contracts';
import { BadRequestError, ForbiddenError } from '@/errors';
import type { InMemoryGameStore } from '@/repositories/game-store/InMemoryGameStore';
import {
  type GameSeed,
  makeBlackCard,
  makeWhiteCard
} from '@/repositories/game-store/gameStore.fixtures';
import { FakeGameEventPublisher } from '@/services/IGameEventPublisher.fakes';
import {
  ROOM_CODE,
  buildService,
  findPlayer,
  makePlayedCards,
  makePlayer,
  makeRoom,
  makeRoomPlayer,
  makeRound
} from '@/services/room/RoomService.fixtures';
import { describe, expect, it } from 'vitest';
import { RoundFlow } from './RoundFlow';
import { RoundTimekeeper } from './RoundTimekeeper';
import { FakeRoundTimerStore } from './RoundTimekeeper.fakes';
import { judgeKey, playKey } from './deadlineKeys';

// RoundFlow over the real game loop: RoomService and RoundTimekeeper on one
// InMemoryGameStore, faking only Redis (the timer store) and the publisher.
// Each case seeds the state that drives the flow instead of scripting what the
// service returns, so the events are checked against what the rules actually
// do. See issue #24.

const JUDGE_ID = 'player-judge';
const TIMER_CONFIG = {
  playWindowSeconds: 60,
  judgeGraceSeconds: 30,
  judgeWindowSeconds: 90
};

type Table = {
  flow: RoundFlow;
  store: InMemoryGameStore;
  timers: FakeRoundTimerStore;
  publisher: FakeGameEventPublisher;
  timekeeper: RoundTimekeeper;
};

// Judge plus two Players, each holding one card named after them, in Round 1.
function tableSeed(overrides: Partial<GameSeed> = {}): GameSeed {
  return {
    room: makeRoom({ judgeId: JUDGE_ID, pickedBlackCards: ['black-1'] }),
    players: [JUDGE_ID, 'player-a', 'player-b'].map(id =>
      makePlayer({ id, cardIds: [`card-${id}`] })
    ),
    rounds: [makeRound({ status: 'PLAYING' })],
    ...overrides
  };
}

async function buildTable(seed: GameSeed = tableSeed()): Promise<Table> {
  const { service, store } = await buildService(seed);
  const timers = new FakeRoundTimerStore();
  const publisher = new FakeGameEventPublisher();
  const timekeeper = new RoundTimekeeper(
    timers,
    store.rounds,
    store.playedCards,
    service,
    publisher,
    TIMER_CONFIG
  );
  const flow = new RoundFlow(service, timekeeper, publisher);
  return { flow, store, timers, publisher, timekeeper };
}

type TimeToJudge = Extract<RoomEvent, { event: 'room.time-to-judge' }>;

function timeToJudgeEvents(publisher: FakeGameEventPublisher): TimeToJudge[] {
  return publisher.published
    .map(({ event }) => event)
    .filter(
      (event: RoomEvent | PlayerEvent): event is TimeToJudge =>
        event.event === 'room.time-to-judge'
    );
}

describe('RoundFlow.playCards', () => {
  it('broadcasts the ready flag and the refilled Hand, and does not advance while others play', async () => {
    const { flow, store, publisher } = await buildTable();

    await flow.playCards(ROOM_CODE, 'player-a', ['card-player-a']);

    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.player-update',
          payload: makeRoomPlayer('player-a', { isReady: true })
        }
      },
      {
        channel: 'player-a',
        event: {
          event: 'player.cards-drawn',
          payload: [makeWhiteCard('pool-1')]
        }
      }
    ]);
    expect((await findPlayer(store, 'player-a'))?.cardIds).toEqual(['pool-1']);
    expect((await store.rounds.findById('round-1'))?.status).toBe('PLAYING');
  });

  it('moves to judging when the last active Player plays, prompting the Judge once', async () => {
    const { flow, store, timers, publisher, timekeeper } = await buildTable();

    await flow.playCards(ROOM_CODE, 'player-a', ['card-player-a']);
    await flow.playCards(ROOM_CODE, 'player-b', ['card-player-b']);
    // The play deadline firing late must not prompt the Judge a second time.
    await timekeeper.onPlayExpired('round-1');

    const prompts = timeToJudgeEvents(publisher);
    expect(prompts).toHaveLength(1);
    const playerIds = prompts[0].payload.roundPlayedCards.map(
      playedCards => playedCards.player.id
    );
    expect(playerIds.sort()).toEqual(['player-a', 'player-b']);
    expect((await store.rounds.findById('round-1'))?.status).toBe('JUDGING');
    expect(timers.armed.get(judgeKey('round-1'))).toBe(90);
  });

  it('does not wait for an Inactive Player', async () => {
    const seed = tableSeed();
    seed.players?.push(makePlayer({ id: 'player-gone', isActive: false }));
    const { flow, store, publisher } = await buildTable(seed);

    await flow.playCards(ROOM_CODE, 'player-a', ['card-player-a']);
    await flow.playCards(ROOM_CODE, 'player-b', ['card-player-b']);

    expect(timeToJudgeEvents(publisher)).toHaveLength(1);
    expect((await store.rounds.findById('round-1'))?.status).toBe('JUDGING');
  });

  it('rejects a play from the Judge and broadcasts nothing', async () => {
    const { flow, publisher } = await buildTable();

    await expect(
      flow.playCards(ROOM_CODE, JUDGE_ID, [`card-${JUDGE_ID}`])
    ).rejects.toThrow(ForbiddenError);
    expect(publisher.published).toEqual([]);
  });
});

describe('RoundFlow.judgePick', () => {
  function judgingSeed(maxPoints = 5): GameSeed {
    return tableSeed({
      room: makeRoom({
        judgeId: JUDGE_ID,
        pickedBlackCards: ['black-1'],
        maxPoints
      }),
      rounds: [makeRound({ status: 'JUDGING' })],
      playedCards: [makePlayedCards('player-a'), makePlayedCards('player-b')]
    });
  }

  it('broadcasts one self-contained round end, then opens and arms the next Round', async () => {
    const { flow, store, timers, publisher } = await buildTable(judgingSeed());
    const answers = await store.playedCards.findByRoomCodeAndRoundNumber(
      ROOM_CODE,
      1
    );

    await flow.judgePick(ROOM_CODE, JUDGE_ID, 'player-b');

    const next = await store.rounds.find(ROOM_CODE, 2);
    expect(next?.judgeId).not.toBe(JUDGE_ID);
    expect(publisher.published).toEqual([
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.round-end',
          payload: {
            roundNumber: 1,
            winner: answers.find(answer => answer.player.id === 'player-b'),
            winnerId: 'player-b',
            newScore: 1,
            reason: 'picked'
          }
        }
      },
      {
        channel: ROOM_CODE,
        event: {
          event: 'room.round-start',
          payload: {
            roundNumber: 2,
            judgeId: next?.judgeId,
            blackCard: makeBlackCard({ id: 'black-2' })
          }
        }
      }
    ]);
    expect(timers.armed.get(playKey(next?.id ?? ''))).toBe(60);
  });

  it('leaves exactly the new Judge flagged, everyone unready for Round 2', async () => {
    const { flow, store } = await buildTable(judgingSeed());

    await flow.judgePick(ROOM_CODE, JUDGE_ID, 'player-b');

    const next = await store.rounds.find(ROOM_CODE, 2);
    const players = await store.players.getRoomPlayersByCode(ROOM_CODE);
    const judges = players
      .filter(player => player.isJudge)
      .map(player => player.id);
    expect(judges).toEqual([next?.judgeId]);
    expect(players.every(player => !player.isReady)).toBe(true);
    expect((await findPlayer(store, 'player-b'))?.score).toBe(1);
  });

  it('ends the game instead of opening a Round when the win-condition is met', async () => {
    const { flow, store, timers, publisher } = await buildTable(judgingSeed(1));

    await flow.judgePick(ROOM_CODE, JUDGE_ID, 'player-b');

    expect(publisher.published.at(-1)).toEqual({
      channel: ROOM_CODE,
      event: {
        event: 'room.game-end',
        payload: [
          { id: 'player-b', username: 'player-b', avatarUrl: null, score: 1 },
          { id: JUDGE_ID, username: JUDGE_ID, avatarUrl: null, score: 0 },
          { id: 'player-a', username: 'player-a', avatarUrl: null, score: 0 }
        ]
      }
    });
    expect((await store.rooms.getRoomByCode(ROOM_CODE))?.status).toBe(
      'FINISHED'
    );
    expect(await store.rounds.find(ROOM_CODE, 2)).toBeNull();
    expect(timers.armed.size).toBe(0);
  });

  it('rejects a second pick of the same Round and broadcasts nothing more', async () => {
    const { flow, publisher } = await buildTable(judgingSeed());
    await flow.judgePick(ROOM_CODE, JUDGE_ID, 'player-b');
    const sent = publisher.published.length;

    await expect(
      flow.judgePick(ROOM_CODE, JUDGE_ID, 'player-a')
    ).rejects.toThrow();
    expect(publisher.published).toHaveLength(sent);
  });
});

describe('RoundFlow.playerReady', () => {
  it('toggles the ready flag in the LOBBY and broadcasts the Player update', async () => {
    const { flow, store, publisher } = await buildTable(
      tableSeed({
        room: makeRoom({ status: 'LOBBY', round: 0, judgeId: null }),
        rounds: []
      })
    );

    await flow.playerReady(ROOM_CODE, 'player-a');

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
    const { flow, publisher } = await buildTable();

    await expect(flow.playerReady(ROOM_CODE, 'player-a')).rejects.toThrow(
      BadRequestError
    );
    expect(publisher.published).toEqual([]);
  });
});
