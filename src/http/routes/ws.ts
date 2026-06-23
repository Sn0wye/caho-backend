import type { App } from '@/app';
import { logger } from '@/lib/logger';
import { broadcastHostLoss } from '@/http/broadcastHostLoss';
import { handleJudgeLoss } from '@/http/handleJudgeLoss';
import { RoomServiceFactory } from '@/services/room/RoomServiceFactory';
import { RoundTimekeeperFactory } from '@/services/round/RoundTimekeeperFactory';
import { z } from 'zod';

export const wsRoutes = async (app: App) => {
  const roomService = RoomServiceFactory();
  const timekeeper = RoundTimekeeperFactory();

  // The per-user socket's close is attributable to a userId (unlike the Room
  // socket, keyed by Code), so it drives presence: a drop marks the Player
  // Inactive, a (re)connect marks them active, broadcasting to each Room they
  // are in. See ADR-0002.
  const broadcastPresence = async (userId: string, isActive: boolean) => {
    const roomCodes = await roomService.getPlayerRoomCodes(userId);

    for (const roomCode of roomCodes) {
      try {
        const player = await roomService.setPlayerActive(
          roomCode,
          userId,
          isActive
        );

        await app.pubsub.publish(roomCode, {
          event: 'room.player-update',
          payload: player
        });

        // A drop that takes the Host triggers status-dependent fallout: the Room
        // ends (LOBBY, or no active Players left) or the Host role is reassigned.
        // Only a drop (not a reconnect) can lose the Host. See ADR-0002, issue #3.
        if (!isActive) {
          const hostLoss = await roomService.handleHostLoss(roomCode, userId);
          await broadcastHostLoss(app, roomCode, hostLoss);

          // A dropped Judge holds the Round: arm the judge-grace timer so it
          // aborts+rotates only if the Judge never reconnects. See ADR-0002/0003.
          await handleJudgeLoss(roomService, timekeeper, roomCode, userId, 'drop');
        }
      } catch (error) {
        // A concurrent Leave can delete the row mid-flight; skip that Room
        // rather than tear down the socket handler.
        logger.warn({ userId, roomCode, isActive, error }, 'presence broadcast failed');
      }
    }
  };

  app.get(
    '/room/:roomCode',
    {
      websocket: true,
      schema: {
        tags: ['Rooms (Websocket)'],
        description: 'Listen for room events',
        params: z.object({
          roomCode: z.string().min(6).max(6)
        })
      }
    },
    async (conn, req) => {
      const disconnect = await app.pubsub.subscribe(
        req.params.roomCode,
        message => {
          conn.socket.send(JSON.stringify(message));
        }
      );

      conn.socket.on('ping', () => {
        conn.socket.pong();
      });

      conn.socket.on('close', disconnect);
    }
  );

  app.get(
    '/:userId',
    {
      websocket: true,
      schema: {
        tags: ['Rooms (Websocket)'],
        description: 'Listen for user events',
        params: z.object({
          userId: z.string()
        })
      }
    },
    async (conn, req) => {
      const { userId } = req.params;
      const disconnect = await app.pubsub.subscribe(userId, message => {
        conn.socket.send(JSON.stringify(message));
      });

      await broadcastPresence(userId, true);

      conn.socket.on('ping', () => {
        conn.socket.pong();
      });

      conn.socket.on('close', async () => {
        await disconnect();
        await broadcastPresence(userId, false);
      });
    }
  );
};
