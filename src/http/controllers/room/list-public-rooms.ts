import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { listPublicRoomsResponse } from '@/contracts';
import { ensureAuth } from '@/plugins/ensure-auth';

export const listPublicController = async (
  app: App,
  { roomView }: GameModules
) => {
  app.register(ensureAuth).get(
    '/list',
    {
      schema: {
        tags: ['Rooms'],
        description: 'List public rooms',
        response: {
          200: listPublicRoomsResponse
        },
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async () => roomView.publicRooms()
  );
};
