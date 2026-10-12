import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { ensureAuth } from '@/plugins/ensure-auth';
import { z } from 'zod';

export const judgeChooseWinner = async (
  app: App,
  { rounds }: GameModules
) => {
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

      await rounds.judgePick(roomCode, user.id, winnerPlayerId);

      return { success: true };
    }
  );
};
