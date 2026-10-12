import type { App } from '@/app';
import { completeSocketUpgrade } from '@/http/request-observability';
import { SocketSession } from '@/http/socket-session';
import { SocketSessions } from '@/http/socket-session';
import type { IGameEventSubscriber } from '@/services/IGameEventSubscriber';
import type { RoomOrchestrator } from '@/services/room/RoomOrchestrator';
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

export const wsRoutes = async (
  app: App,
  {
    rooms: roomOrchestrator,
    subscriber
  }: { rooms: RoomOrchestrator; subscriber: IGameEventSubscriber }
) => {
  const sessions = new SocketSessions();
  app.addHook('onClose', () => sessions.close());

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
        app.log.warn(
          {
            event: 'ws.presence_broadcast_failed',
            userId,
            roomCode,
            isActive,
            err: error
          },
          'presence broadcast failed'
        );
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
      completeSocketUpgrade(req);
      if (!sessionUserId(req)) {
        req.log.warn(
          { event: 'ws.auth_rejected', reason: 'unauthenticated' },
          'WebSocket rejected'
        );
        conn.socket.close(WS_POLICY_VIOLATION, 'unauthenticated');
        return;
      }

      sessions.open(
        new SocketSession(
          conn.socket,
          req.log,
          req.params.roomCode,
          (channel, receive) => subscriber.subscribe(channel, receive)
        )
      );
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
      completeSocketUpgrade(req);
      const { userId } = req.params;
      // This channel carries the private Hand and drives presence, so only its
      // owner may open it. Unauthenticated, anyone could read any Player's cards
      // and mark them inactive by opening and closing a socket.
      if (sessionUserId(req) !== userId) {
        req.log.warn(
          { event: 'ws.auth_rejected', reason: 'forbidden' },
          'WebSocket rejected'
        );
        conn.socket.close(WS_POLICY_VIOLATION, 'forbidden');
        return;
      }

      sessions.open(
        new SocketSession(
          conn.socket,
          req.log,
          userId,
          (channel, receive) => subscriber.subscribe(channel, receive),
          {
            connected: () => broadcastPresence(userId, true),
            disconnected: () => broadcastPresence(userId, false)
          }
        )
      );
    }
  );
};
