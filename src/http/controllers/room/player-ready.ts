import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { ensureAuth } from '@/plugins/ensure-auth';
import { z } from 'zod';

export const playerReadyController = async (
  app: App,
  { rooms: roomOrchestrator }: GameModules
) => {
  app.register(ensureAuth).post(
    '/:roomCode/ready',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Toggle player ready status',
        params: z.object({
          roomCode: z.string().min(6).max(6)
        }),
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async (req, res) => {
      const userId = req.getUser().id;
      const { roomCode } = req.params;

      await roomOrchestrator.playerReady(roomCode, userId);

      // An async handler resolving undefined never replies in Fastify 4.
      return res.status(204).send();
    }
  );
};
