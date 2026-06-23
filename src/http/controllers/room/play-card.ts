import type { App } from '@/app';
import { ensureAuth } from '@/plugins/ensure-auth';
import { RoundFlowFactory } from '@/services/round/RoundFlowFactory';
import { z } from 'zod';

export const playCardsController = async (app: App) => {
  const roundFlow = RoundFlowFactory();

  app.register(ensureAuth).post(
    '/:roomCode/play-cards',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Jogar cartas na sala',
        params: z.object({
          roomCode: z.string().min(6).max(6)
        }),
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async (req, res) => {
      const user = req.getUser();
      const playedCards = req.body as string[];
      const { roomCode } = req.params;

      await roundFlow.playCards(roomCode, user.id, playedCards);

      return res.status(204).send();
    }
  );
};
