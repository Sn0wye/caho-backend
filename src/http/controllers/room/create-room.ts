import type { App } from '@/app';
import { createRoom } from '@/contracts';
import { ensureAuth } from '@/plugins/ensure-auth';
import type { Player } from '@/schemas';
import { RoomServiceFactory } from '@/services/room/RoomServiceFactory';

export const createRoomController = async (app: App) => {
  const roomService = RoomServiceFactory();

  app.register(ensureAuth).post(
    '/create',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Create a room',
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async (req, res) => {
      const user = req.getUser();

      const validatedBody = createRoom.parse(req.body);

      const host: Player = {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
        score: 0,
        isReady: false,
        isHost: true,
        isJudge: false,
        isActive: true,
        cardIds: []
      };

      const room = await roomService.createRoom({
        ...validatedBody,
        hostId: host.id
      });

      await roomService.addPlayerToRoom({
        roomCode: room.code,
        player: host
      });
      req.log.info(
        { event: 'room.created', roomCode: room.code, userId: host.id },
        'Room created'
      );

      res.status(201);
      return room;
    }
  );
};
