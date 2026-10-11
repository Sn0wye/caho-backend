import { redis } from '@/db/redis';
import { logger } from '@/lib/logger';
import { Pubsub } from '@/lib/pub-sub';
import { PostgresGameStoreFactory } from '@/repositories/game-store/PostgresGameStore';
import { BlackCardDeck } from '@/services/room/BlackCardDeck';
import { RoomServiceFactory } from '@/services/room/RoomServiceFactory';
import { DEFAULT_ROUND_TIMER_CONFIG } from './RoundDeadlines';
import { RoundLifecycle } from './RoundLifecycle';
import { RoundTimerStore } from './RoundTimerStore';

// Wires the production RoundLifecycle: the Postgres game store, RoomService for
// the domain rules, the ioredis deadline store and a Pubsub on the shared redis
// for emission. See issue #25.
export function RoundLifecycleFactory(): RoundLifecycle {
  const store = PostgresGameStoreFactory();
  return new RoundLifecycle(
    store,
    RoomServiceFactory(),
    new BlackCardDeck(store),
    new RoundTimerStore(redis),
    new Pubsub(redis, logger),
    DEFAULT_ROUND_TIMER_CONFIG,
    logger
  );
}
