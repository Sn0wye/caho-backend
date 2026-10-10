import type { App } from '@/app';
import { ensureAuth } from '@/plugins/ensure-auth';
import { RoomServiceFactory } from '@/services/room/RoomServiceFactory';
import { z } from 'zod';

// Current Round snapshot (phase, Judge, deadlines, Black Card, and the Played
// Cards once judging opens) so a reconnecting client can resync; the WS stream
// only carries live deltas. `null` before the game starts.
export const getRoundController = async (app: App) => {
  const roomService = RoomServiceFactory();

  app.register(ensureAuth).get(
    '/:roomCode/round',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Get the current Round snapshot',
        params: z.object({
          roomCode: z.string().min(6).max(6)
        }),
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async req => {
      const { roomCode } = req.params;
      return roomService.getRoundSnapshot(roomCode);
    }
  );
};
