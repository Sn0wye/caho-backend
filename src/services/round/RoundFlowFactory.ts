import { redis } from '@/db/redis';
import { Pubsub } from '@/lib/pub-sub';
import { RoomServiceFactory } from '@/services/room/RoomServiceFactory';
import { RoundFlow } from './RoundFlow';
import { RoundTimekeeperFactory } from './RoundTimekeeperFactory';

// Wires the production RoundFlow: RoomService as the domain step, RoundTimekeeper
// as the play clock (armPlayDeadline / advanceToJudging), and a Pubsub on the
// shared redis for emission — same wiring grain as RoundTimekeeperFactory. ADR-0004.
export function RoundFlowFactory(): RoundFlow {
  return new RoundFlow(
    RoomServiceFactory(),
    RoundTimekeeperFactory(),
    new Pubsub(redis)
  );
}
