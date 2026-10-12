import type { App } from '@/app';
import type { GameModules } from '@/composition/game-modules';
import { ensureAuth } from '@/plugins/ensure-auth';
import { drawnBlackCard } from '@/schemas';
import { z } from 'zod';

export const getRoomBlackCardController = async (
  app: App,
  { roomView }: GameModules
) => {
  app.register(ensureAuth).get(
    '/:roomCode/black-card',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Get the black card of a room',
        params: z.object({
          roomCode: z.string().min(6).max(6)
        }),
        response: {
          200: drawnBlackCard.nullable()
        },
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async req => roomView.blackCard(req.params.roomCode, req.getUser().id)
  );
};
