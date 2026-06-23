import type { App } from '@/app';
import { ensureAuth } from '@/plugins/ensure-auth';
import { RoundFlowFactory } from '@/services/round/RoundFlowFactory';
import { z } from 'zod';

export const playerReadyController = async (app: App) => {
  const roundFlow = RoundFlowFactory();

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
    async req => {
      const userId = req.getUser().id;
      const { roomCode } = req.params;

      await roundFlow.playerReady(roomCode, userId);
    }
  );
};
