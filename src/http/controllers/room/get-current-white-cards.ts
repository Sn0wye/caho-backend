import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { ensureAuth } from '@/plugins/ensure-auth';
import { whiteCard } from '@/schemas';
import { z } from 'zod';

// The caller's own Hand; never anyone else's.
export const getCurrentWhiteCardsController = async (
  app: App,
  { roomView }: GameModules
) => {
  app.register(ensureAuth).get(
    '/:roomCode/white-cards',
    {
      schema: {
        tags: ['Rooms'],
        params: z.object({
          roomCode: z.string().min(6).max(6)
        }),
        response: {
          200: z.array(whiteCard)
        },
        description: 'Get current white cards',
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async req => roomView.hand(req.params.roomCode, req.getUser().id)
  );
};
