import type { PlayerEvent, RoomEvent } from '@/contracts';
import { buildLogger } from '@/lib/logger';
import { FakeConsoleOutput } from '@/lib/logger.fakes';
import type { InMemoryGameStore } from '@/repositories/game-store/InMemoryGameStore';
import type { GameSeed } from '@/repositories/game-store/gameStore.fixtures';
import { FakeGameEventPublisher } from '@/services/IGameEventPublisher.fakes';
import { BlackCardDeck } from '@/services/room/BlackCardDeck';
import {
  ROOM_CODE,
  buildService,
  makePlayedCards,
  makePlayer,
  makeRoom,
  makeRound
} from '@/services/room/RoomService.fixtures';
import type { RoomService } from '@/services/room/RoomService';
import { RoundLifecycle } from './RoundLifecycle';
import { FakeRoundTimerStore } from './RoundTimerStore.fakes';

// Shared table for the RoundLifecycle specs. A Round's whole lifecycle, driven only through RoundLifecycle over the real
// RoomService rules on one InMemoryGameStore. Redis is a FakeRoundTimerStore
// the test expires on demand; events go to a recording publisher. Each case
// seeds state and checks published events and stored Rounds, never which
// internal step ran. See issue #25.

export const JUDGE_ID = 'player-judge';
export const ROUND_ID = 'round-1';
const TIMER_CONFIG = {
  playWindowSeconds: 60,
  judgeGraceSeconds: 30,
  judgeWindowSeconds: 90
};

export type Table = {
  rounds: RoundLifecycle;
  service: RoomService;
  store: InMemoryGameStore;
  timers: FakeRoundTimerStore;
  publisher: FakeGameEventPublisher;
  output: FakeConsoleOutput;
};

// Judge plus two Players, each holding one card named after them, in Round 1.
export function tableSeed(overrides: Partial<GameSeed> = {}): GameSeed {
  return {
    room: makeRoom({ judgeId: JUDGE_ID, pickedBlackCards: ['black-1'] }),
    players: [JUDGE_ID, 'player-a', 'player-b'].map(id =>
      makePlayer({ id, cardIds: [`card-${id}`] })
    ),
    rounds: [makeRound({ status: 'PLAYING' })],
    ...overrides
  };
}

export function judgingSeed(maxPoints = 5): GameSeed {
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

/**
 * A RoundLifecycle over the real RoomService rules, fake timers and publisher.
 *
 * @example
 * const table = await buildTable(tableSeed({ rounds: [] }));
 */
export async function buildTable(seed: GameSeed = tableSeed()): Promise<Table> {
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
    publisher,
    TIMER_CONFIG,
    logger
  );
  return { rounds, service, store, timers, publisher, output };
}

export type EventName = (RoomEvent | PlayerEvent)['event'];

export function eventsNamed(
  table: Table,
  name: EventName
): Array<RoomEvent | PlayerEvent> {
  return table.publisher.published
    .map(({ event }) => event)
    .filter(event => event.event === name);
}

export async function phaseOf(
  table: Table,
  roundNumber = 1
): Promise<string | undefined> {
  return (await table.store.rounds.find(ROOM_CODE, roundNumber))?.status;
}

export function expire(table: Table, key: string): Promise<void> {
  return table.timers.expire(key, expired => table.rounds.onExpired(expired));
}

export async function playAll(
  table: Table,
  ids = ['player-a', 'player-b']
): Promise<void> {
  for (const id of ids) {
    await table.rounds.playCards(ROOM_CODE, id, [`card-${id}`]);
  }
}
