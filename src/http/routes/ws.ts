import type { App } from '@/app';
import { logger } from '@/lib/logger';
import { RoomOrchestratorFactory } from '@/services/room/RoomOrchestratorFactory';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

// Policy-violation close code: the socket was rejected for auth reasons.
const WS_POLICY_VIOLATION = 1008;

// The auth plugin's preHandler runs on the upgrade request, so the session
// cookie resolves here like on any HTTP route. null when unauthenticated.
const sessionUserId = (req: FastifyRequest): string | null => {
  try {
    return req.getUser().id;
  } catch {
    return null;
  }
};

export const wsRoutes = async (app: App) => {
  const roomOrchestrator = RoomOrchestratorFactory();

  // The per-user socket's close is attributable to a userId (unlike the Room
  // socket, keyed by Code), so it drives presence: a drop marks the Player
  // Inactive, a (re)connect marks them active, broadcasting to each Room they
  // are in. The per-Room presence change + departure fallout lives in the
  // orchestrator; here we only fan out across the Player's Rooms and isolate a
  // concurrent-Leave failure to its Room. See ADR-0002.
  const broadcastPresence = async (userId: string, isActive: boolean) => {
    const roomCodes = await roomOrchestrator.playerRoomCodes(userId);

    for (const roomCode of roomCodes) {
      try {
        await roomOrchestrator.markPresence(roomCode, userId, isActive);
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
      if (!sessionUserId(req)) {
        conn.socket.close(WS_POLICY_VIOLATION, 'unauthenticated');
        return;
      }

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
      // This channel carries the private Hand and drives presence, so only its
      // owner may open it. Unauthenticated, anyone could read any Player's cards
      // and mark them inactive by opening and closing a socket.
      if (sessionUserId(req) !== userId) {
        conn.socket.close(WS_POLICY_VIOLATION, 'forbidden');
        return;
      }

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
