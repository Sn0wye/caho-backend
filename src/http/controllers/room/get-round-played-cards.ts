import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { ensureAuth } from '@/plugins/ensure-auth';
import { roundPlayedCardsSchema } from '@/schemas';
import { z } from 'zod';

// Empty for everyone, the Judge included, until the Round reaches judging.
export const getRoundPlayedCardsController = async (
  app: App,
  { roomView }: GameModules
) => {
  app.register(ensureAuth).get(
    '/:roomCode/round-played-cards',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Get the current Round played cards once judging opens',
        params: z.object({
          roomCode: z.string().min(6).max(6)
        }),
        response: {
          200: z.array(roundPlayedCardsSchema)
        },
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async req => roomView.playedCards(req.params.roomCode, req.getUser().id)
  );
};
