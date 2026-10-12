import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { ensureAuth } from '@/plugins/ensure-auth';
import { endRoom } from '@/contracts';

export const endRoomController = async (
  app: App,
  { rooms: roomOrchestrator }: GameModules
) => {
  app.register(ensureAuth).post(
    '/end',
    {
      schema: {
        tags: ['Rooms'],
        description: 'End a room',
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async req => {
      const user = req.getUser();
      const { roomCode } = endRoom.parse(req.body);

      return roomOrchestrator.endRoom(roomCode, user.id);
    }
  );
};
