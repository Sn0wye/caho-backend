import type { App } from '@/app';
import { ensureAuth } from '@/plugins/ensure-auth';
import { RoomOrchestratorFactory } from '@/services/room/RoomOrchestratorFactory';
import { joinRoomRequest } from '@/contracts';
import type { Player } from '@/schemas';

export const joinRoomController = async (app: App) => {
  const roomOrchestrator = RoomOrchestratorFactory();

  app.register(ensureAuth).post(
    '/join',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Join a room',
        body: joinRoomRequest,
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async req => {
      const user = req.getUser();
      const { roomCode, password } = req.body;

      const player: Player = {
        id: user.id,
        score: 0,
        username: user.username,
        avatarUrl: user.avatarUrl,
        isReady: false,
        isHost: false,
        isJudge: false,
        isActive: true,
        cardIds: []
      };

      return roomOrchestrator.joinRoom({ roomCode, password, player });
    }
  );
};
