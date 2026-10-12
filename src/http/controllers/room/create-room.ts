import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { createRoom } from '@/contracts';
import { ensureAuth } from '@/plugins/ensure-auth';
import { sanitizedRoomSchema } from '@/schemas';

export const createRoomController = async (
  app: App,
  { rooms }: GameModules
) => {
  app.register(ensureAuth).post(
    '/create',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Create a room',
        response: {
          201: sanitizedRoomSchema
        },
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async (req, res) => {
      const room = await rooms.createRoom(
        createRoom.parse(req.body),
        req.getUser()
      );
      res.status(201);
      return room;
    }
  );
};
