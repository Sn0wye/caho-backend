import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { listRoomsResponse } from '@/contracts';
import { ensureAuth } from '@/plugins/ensure-auth';

export const listRoomsController = async (
  app: App,
  { roomView }: GameModules
) => {
  app.register(ensureAuth).get(
    '/list',
    {
      schema: {
        tags: ['Rooms'],
        description: 'List every LOBBY Room, flagging the ones with a password',
        response: {
          200: listRoomsResponse
        },
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async () => roomView.lobbyRooms()
  );
};
