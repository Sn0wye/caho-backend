import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { ensureAuth } from '@/plugins/ensure-auth';
import { leaveRoom } from '@/contracts';

export const leaveRoomController = async (
  app: App,
  { rooms: roomOrchestrator }: GameModules
) => {
  app.register(ensureAuth).post(
    '/leave',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Leave a room',
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async (req, res) => {
      const user = req.getUser();
      const { roomCode } = leaveRoom.parse(req.body);

      await roomOrchestrator.leaveRoom(roomCode, user.id);

      return res.status(204).send();
    }
  );
};
