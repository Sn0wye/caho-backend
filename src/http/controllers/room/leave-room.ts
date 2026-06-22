import type { App } from '@/app';
import { ensureAuth } from '@/plugins/ensure-auth';
import { RoomServiceFactory } from '@/services/room/RoomServiceFactory';
import { leaveRoom } from '@/contracts';
import { broadcastHostLoss } from '@/http/broadcastHostLoss';

export const leaveRoomController = async (app: App) => {
  const roomService = RoomServiceFactory();

  app.register(ensureAuth).post(
    '/leave',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Leave a room',
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async (req, res) => {
      const user = req.getUser();

      const { roomCode } = leaveRoom.parse(req.body);
      // Capture the Host fallout before removing the row, then remove. Leave
      // deletes the Player, so handleHostLoss reads the Room (hostId still set)
      // and the remaining active Players to pick an heir or end the Room (#3).
      await roomService.leaveRoom({
        roomCode,
        playerId: user.id
      });
      const hostLoss = await roomService.handleHostLoss(roomCode, user.id);

      await app.pubsub.publish(roomCode, {
        event: 'room.player-left',
        payload: {
          id: user.id
        }
      });
      await broadcastHostLoss(app, roomCode, hostLoss);

      return res.status(204);
    }
  );
};
