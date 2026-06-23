import type { App } from '@/app';
import { ensureAuth } from '@/plugins/ensure-auth';
import { RoomOrchestratorFactory } from '@/services/room/RoomOrchestratorFactory';
import { endRoom } from '@/contracts';

export const endRoomController = async (app: App) => {
  const roomOrchestrator = RoomOrchestratorFactory();

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
