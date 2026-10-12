import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { ensureAuth } from '@/plugins/ensure-auth';
import { roundSnapshotSchema } from '@/schemas';
import { z } from 'zod';

// Current Round snapshot (phase, Judge, deadlines, Black Card, and the Played
// Cards once judging opens) so a reconnecting client can resync; the WS stream
// only carries live deltas. `null` before the game starts.
export const getRoundController = async (
  app: App,
  { roomView }: GameModules
) => {
  app.register(ensureAuth).get(
    '/:roomCode/round',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Get the current Round snapshot',
        params: z.object({
          roomCode: z.string().min(6).max(6)
        }),
        response: {
          200: roundSnapshotSchema.nullable()
        },
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async req => roomView.round(req.params.roomCode, req.getUser().id)
  );
};
