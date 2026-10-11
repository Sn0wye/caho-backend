import { redis } from '@/db/redis';
import { logger } from '@/lib/logger';
import { Pubsub } from '@/lib/pub-sub';
import { PostgresGameStoreFactory } from '@/repositories/game-store/PostgresGameStore';
import { RoomServiceFactory } from '@/services/room/RoomServiceFactory';
import { DEFAULT_ROUND_TIMER_CONFIG, RoundTimekeeper } from './RoundTimekeeper';
import { RoundTimerStore } from './RoundTimerStore';

// Wires the production RoundTimekeeper: ioredis store, the Postgres game store's
// Rounds (as the timer port) and Played Cards (for the play-count check), RoomService as
// the Judge-rotation path (its startNextRound), and Pubsub so a timer-driven
// advance broadcasts to the Room. See issue #4.
export function RoundTimekeeperFactory(): RoundTimekeeper {
  const store = PostgresGameStoreFactory();
  return new RoundTimekeeper(
    new RoundTimerStore(redis),
    store.rounds,
    store.playedCards,
    RoomServiceFactory(),
    new Pubsub(redis, logger),
    DEFAULT_ROUND_TIMER_CONFIG,
    logger
  );
}
