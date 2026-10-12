import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { ensureAuth } from '@/plugins/ensure-auth';
import { z } from 'zod';

export const playCardsController = async (
  app: App,
  { rounds }: GameModules
) => {
  app.register(ensureAuth).post(
    '/:roomCode/play-cards',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Jogar cartas na sala',
        params: z.object({
          roomCode: z.string().min(6).max(6)
        }),
        // Body is the ordered list of White Card ids (order matters for pick 2/3).
        body: z.array(z.string().min(1)).min(1).max(3),
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async (req, res) => {
      const user = req.getUser();
      const playedCards = req.body;
      const { roomCode } = req.params;

      await rounds.playCards(roomCode, user.id, playedCards);

      return res.status(204).send();
    }
  );
};
