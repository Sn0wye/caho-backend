import type { App } from '@/app';
import { getRoomPlayersResponse } from '@/contracts';
import { ensureAuth } from '@/plugins/ensure-auth';
import { toRoomPlayer } from '@/schemas';
import { RoomServiceFactory } from '@/services/room/RoomServiceFactory';
import { z } from 'zod';

// Any signed-in User may read a Room's players: the join prompt shows the
// player count and Host to non-members. So the response is the public
// RoomPlayer view only; the Hand comes from GET /:roomCode/white-cards.
// See ADR-0005 and issue #27.
export const getRoomPlayersController = async (app: App) => {
  const roomService = RoomServiceFactory();

  app.register(ensureAuth).get(
    '/:roomCode/players',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Get the players of a room',
        params: z.object({
          roomCode: z.string().min(6).max(6)
        }),
        response: {
          200: getRoomPlayersResponse
        },
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async req => {
      const { roomCode } = req.params;
      const players = await roomService.getRoomPlayers(roomCode);
      return players.map(toRoomPlayer);
    }
  );
};
