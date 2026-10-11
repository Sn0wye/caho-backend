import { redis } from '@/db/redis';
import { logger } from '@/lib/logger';
import { Pubsub } from '@/lib/pub-sub';
import { RoundLifecycleFactory } from '@/services/round/RoundLifecycleFactory';
import { RoomOrchestrator } from './RoomOrchestrator';
import { RoomServiceFactory } from './RoomServiceFactory';

// Wires the production RoomOrchestrator: RoomService for membership/lifecycle,
// RoundLifecycle for everything about a Round, and a Pubsub on the shared redis
// for emission — same wiring grain as RoundLifecycleFactory. ADR-0004.
export function RoomOrchestratorFactory(): RoomOrchestrator {
  return new RoomOrchestrator(
    RoomServiceFactory(),
    RoundLifecycleFactory(),
    new Pubsub(redis, logger),
    logger
  );
}
