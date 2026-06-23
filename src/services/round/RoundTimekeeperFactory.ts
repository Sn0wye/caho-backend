import { redis } from '@/db/redis';
import { RoundRepository } from '@/repositories/round/RoundRepository';
import { RoundPlayedCardsRepositoryFactory } from '@/repositories/round-played-cards';
import { RoomServiceFactory } from '@/services/room/RoomServiceFactory';
import { RoundTimekeeper } from './RoundTimekeeper';
import { RoundTimerStore } from './RoundTimerStore';

// Wires the production RoundTimekeeper: ioredis store, the Round repo (as the
// timer port), the played-cards repo for the play-count check, and RoomService
// as the Judge-rotation path (its startNextRound). See issue #4.
export function RoundTimekeeperFactory(): RoundTimekeeper {
  return new RoundTimekeeper(
    new RoundTimerStore(redis),
    new RoundRepository(),
    RoundPlayedCardsRepositoryFactory(),
    RoomServiceFactory()
  );
}
