import type { App } from '@/app';
import type { HostLossOutcome } from '@/services/room/IRoomService';

// Broadcasts the result of a Host departing (issue #3). A reassignment carries the
// new Host as a `room.player-update`; a Room-end reuses `room.game-end` (the Room
// is FINISHED, here is the final Ranking) so clients disconnect. `not-host` is
// silent. Shared by the REST Leave path and the WebSocket drop path.
export const broadcastHostLoss = async (
  app: App,
  roomCode: string,
  outcome: HostLossOutcome
): Promise<void> => {
  if (outcome.kind === 'host-reassigned') {
    await app.pubsub.publish(roomCode, {
      event: 'room.player-update',
      payload: outcome.newHost
    });
    return;
  }

  if (outcome.kind === 'room-ended') {
    await app.pubsub.publish(roomCode, {
      event: 'room.game-end',
      payload: outcome.ranking
    });
  }
};
