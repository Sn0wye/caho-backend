import { redis } from '@/db/redis';
import { logger } from '@/lib/logger';
import { Pubsub } from '@/lib/pub-sub';
import { RoundPlayedCardsRepositoryFactory } from '@/repositories/round-played-cards';
import { RoundRepository } from '@/repositories/round/RoundRepository';
import { RoomServiceFactory } from '@/services/room/RoomServiceFactory';
import { DEFAULT_ROUND_TIMER_CONFIG, RoundTimekeeper } from './RoundTimekeeper';
import { RoundTimerStore } from './RoundTimerStore';

// Wires the production RoundTimekeeper: ioredis store, the Round repo (as the
// timer port), the played-cards repo for the play-count check, RoomService as
// the Judge-rotation path (its startNextRound), and Pubsub so a timer-driven
// advance broadcasts to the Room. See issue #4.
export function RoundTimekeeperFactory(): RoundTimekeeper {
  return new RoundTimekeeper(
    new RoundTimerStore(redis),
    new RoundRepository(),
    RoundPlayedCardsRepositoryFactory(),
    RoomServiceFactory(),
    new Pubsub(redis, logger),
    DEFAULT_ROUND_TIMER_CONFIG,
    logger
  );
}
