import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { ensureAuth } from '@/plugins/ensure-auth';
import { startRoom } from '@/contracts';

export const startRoomController = async (
  app: App,
  { rooms: roomOrchestrator }: GameModules
) => {
  app.register(ensureAuth).post(
    '/start',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Start a room',
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async (req, res) => {
      const user = req.getUser();
      const { roomCode } = startRoom.parse(req.body);

      await roomOrchestrator.startRoom(roomCode, user.id);

      return res.status(204).send();
    }
  );
};
