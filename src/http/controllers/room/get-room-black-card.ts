import type { App } from '@/app';
import { NotFoundError } from '@/errors';
import { ensureAuth } from '@/plugins/ensure-auth';
import { CardServiceFactory } from '@/services/CardServiceFactory';
import { RoomServiceFactory } from '@/services/room/RoomServiceFactory';
import { z } from 'zod';

export const getRoomBlackCardController = async (app: App) => {
  const roomService = RoomServiceFactory();

  app.register(ensureAuth).get(
    '/:roomCode/black-card',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Get the black card of a room',
        params: z.object({
          roomCode: z.string().min(6).max(6)
        }),
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async (req, _res) => {
      const { roomCode } = req.params;

      const cardService = CardServiceFactory(roomCode);

      const blackCardId = await roomService.getRoomBlackCardId(roomCode);

      if (!blackCardId) {
        return null;
      }

      const blackCard = cardService.getBlackCardById(blackCardId);

      if (!blackCard) {
        throw new NotFoundError('Carta preta não encontrada');
      }

      return blackCard;
    }
  );
};
