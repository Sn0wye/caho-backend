import type { PlayerEvent, RoomEvent } from '@/contracts';
import { FakeGameEventPublisher } from '@/services/IGameEventPublisher.fakes';
import {
  ROOM_CODE,
  buildService,
  makePlayer,
  makeRoom,
  makeRound
} from '@/services/room/RoomService.fixtures';
import { describe, expect, it } from 'vitest';
import { RoundFlow } from './RoundFlow';
import { RoundTimekeeper } from './RoundTimekeeper';
import { FakeRoundTimerStore } from './RoundTimekeeper.fakes';

// End-to-end game-loop scenarios: the real RoundFlow, RoomService and
// RoundTimekeeper over one InMemoryGameStore, faking only Redis and the
// publisher. Possible now that a play is readable straight after it is
// written and isJudge follows the Room. See issue #24.

const PLAYER_IDS = ['player-judge', 'player-a', 'player-b'];

async function buildTable() {
  const { service, store } = await buildService({
    room: makeRoom({ judgeId: 'player-judge' }),
    players: PLAYER_IDS.map(id => makePlayer({ id, cardIds: [`${id}-card`] })),
    rounds: [makeRound({ status: 'PLAYING' })]
  });
  const publisher = new FakeGameEventPublisher();
  const timers = new FakeRoundTimerStore();
  const timekeeper = new RoundTimekeeper(
    timers,
    store.rounds,
    store.playedCards,
    service,
    publisher
  );
  const flow = new RoundFlow(service, timekeeper, publisher);
  return { flow, store, publisher, timekeeper };
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

describe('RoundFlow over the in-memory game store', () => {
  it('moves to judging when the last active Player plays, prompting the Judge once', async () => {
    const { flow, store, publisher, timekeeper } = await buildTable();

    await flow.playCards(ROOM_CODE, 'player-a', ['player-a-card']);
    expect(timeToJudgeEvents(publisher)).toHaveLength(0);
    await flow.playCards(ROOM_CODE, 'player-b', ['player-b-card']);
    // The play deadline firing late must not prompt the Judge a second time.
    await timekeeper.onPlayExpired('round-1');

    const prompts = timeToJudgeEvents(publisher);
    expect(prompts).toHaveLength(1);
    const playerIds = prompts[0].payload.roundPlayedCards.map(
      play => play.player.id
    );
    expect(playerIds.sort()).toEqual(['player-a', 'player-b']);
    expect((await store.rounds.findById('round-1'))?.status).toBe('JUDGING');
  });

  it('scores the pick and opens the next Round with a new Judge', async () => {
    const { flow, store } = await buildTable();
    await flow.playCards(ROOM_CODE, 'player-a', ['player-a-card']);
    await flow.playCards(ROOM_CODE, 'player-b', ['player-b-card']);

    await flow.judgePick(ROOM_CODE, 'player-judge', 'player-b');

    expect((await store.rounds.findById('round-1'))?.status).toBe('COMPLETE');
    const next = await store.rounds.find(ROOM_CODE, 2);
    expect(next?.status).toBe('PLAYING');
    expect(next?.judgeId).not.toBe('player-judge');
    const players = await store.players.getRoomPlayersByCode(ROOM_CODE);
    expect(players.find(player => player.id === 'player-b')?.score).toBe(1);
    expect(
      players.filter(player => player.isJudge).map(player => player.id)
    ).toEqual([next?.judgeId]);
    expect(players.every(player => !player.isReady)).toBe(true);
  });
});
