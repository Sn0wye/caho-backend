import { redis } from '@/db/redis';
import { Pubsub } from '@/lib/pub-sub';
import { RoundTimekeeperFactory } from '@/services/round/RoundTimekeeperFactory';
import { RoomOrchestrator } from './RoomOrchestrator';
import { RoomServiceFactory } from './RoomServiceFactory';

// Wires the production RoomOrchestrator: RoomService for membership/lifecycle,
// RoundTimekeeper as the Judge-grace clock, and a Pubsub on the shared redis for
// emission — same wiring grain as RoundTimekeeperFactory / RoundFlowFactory. ADR-0004.
export function RoomOrchestratorFactory(): RoomOrchestrator {
  return new RoomOrchestrator(
    RoomServiceFactory(),
    RoundTimekeeperFactory(),
    new Pubsub(redis)
  );
}
