import type { App } from '@/app';
import { ensureAuth } from '@/plugins/ensure-auth';
import { RoundFlowFactory } from '@/services/round/RoundFlowFactory';
import { z } from 'zod';

export const judgeChooseWinner = async (app: App) => {
  const roundFlow = RoundFlowFactory();

  app.register(ensureAuth).post(
    '/:roomCode/winner',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Judge chooses a winner for the current round',
        body: z.object({
          winnerPlayerId: z.string()
        }),
        params: z.object({
          roomCode: z.string().min(6).max(6)
        }),
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async req => {
      const user = req.getUser();
      const { roomCode } = req.params;
      const { winnerPlayerId } = req.body;

      await roundFlow.judgePick(roomCode, user.id, winnerPlayerId);

      return { success: true };
    }
  );
};
