import type { IGameStore } from '@/repositories/game-store/IGameStore';
import type { IGameEventPublisher } from '@/services/IGameEventPublisher';
import { BlackCardDeck } from '@/services/room/BlackCardDeck';
import { RoomOrchestrator } from '@/services/room/RoomOrchestrator';
import { RoomService } from '@/services/room/RoomService';
import { RoomView } from '@/services/room/RoomView';
import { WhiteCardDealer } from '@/services/room/WhiteCardDealer';
import type { IRoundTimerStore } from '@/services/round/IRoundTimerStore';
import type { RoundTimerConfig } from '@/services/round/RoundDeadlines';
import { RoundLifecycle } from '@/services/round/RoundLifecycle';
import type { Logger } from 'pino';

// The I/O the game modules run on. Production passes Postgres + Redis; specs
// pass InMemoryGameStore, a fake timer store and a recording publisher.
export type GameAdapters = {
  store: IGameStore;
  timerStore: IRoundTimerStore;
  publisher: IGameEventPublisher;
  roundTimerConfig?: RoundTimerConfig;
  log?: Logger;
};

// The game modules routes call: commands (RoomOrchestrator, RoundLifecycle)
// and reads (RoomView).
export type GameModules = {
  rooms: RoomOrchestrator;
  rounds: RoundLifecycle;
  roomView: RoomView;
};

/**
 * Build every game module once over one set of adapters, so they share one
 * store, one deck and one publisher. Each controller used to build its own
 * through a factory at registration. issue #26.
 *
 * @example
 * const game = buildGameModules({ store, timerStore, publisher, log: logger });
 * await game.roomView.players('ABC123');
 */
export function buildGameModules(adapters: GameAdapters): GameModules {
  const { store, publisher, log } = adapters;
  const deck = new BlackCardDeck(store);
  const roomService = new RoomService(store, new WhiteCardDealer(store), deck);
  const rounds = new RoundLifecycle(
    store,
    roomService,
    deck,
    adapters.timerStore,
    publisher,
    adapters.roundTimerConfig,
    log
  );
  return {
    rooms: new RoomOrchestrator(roomService, rounds, publisher, log),
    rounds,
    roomView: new RoomView(store, deck)
  };
}
