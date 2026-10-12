import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { joinRoomRequest, joinRoomResponse } from '@/contracts';
import { ensureAuth } from '@/plugins/ensure-auth';

export const joinRoomController = async (
  app: App,
  { rooms }: GameModules
) => {
  app.register(ensureAuth).post(
    '/join',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Join a room',
        body: joinRoomRequest,
        response: {
          200: joinRoomResponse
        },
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async req => rooms.joinRoom({ ...req.body, user: req.getUser() })
  );
};
