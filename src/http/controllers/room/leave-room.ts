import type { App } from '@/app';
import { ensureAuth } from '@/plugins/ensure-auth';
import { RoomOrchestratorFactory } from '@/services/room/RoomOrchestratorFactory';
import { leaveRoom } from '@/contracts';

export const leaveRoomController = async (app: App) => {
  const roomOrchestrator = RoomOrchestratorFactory();

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

      return res.status(204);
    }
  );
};
