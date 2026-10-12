import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { ensureAuth } from '@/plugins/ensure-auth';
import { sanitizedRoomSchema } from '@/schemas';
import { z } from 'zod';

export const getRoomController = async (
  app: App,
  { roomView }: GameModules
) => {
  app.register(ensureAuth).get(
    '/:roomCode',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Get a room',
        params: z.object({
          roomCode: z.string().min(6).max(6)
        }),
        response: {
          200: sanitizedRoomSchema
        },
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async req => roomView.room(req.params.roomCode)
  );
};
