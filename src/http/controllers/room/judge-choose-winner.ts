import type { App } from '@/app';
import { ensureAuth } from '@/plugins/ensure-auth';
import { RoomServiceFactory } from '@/services/room/RoomServiceFactory';
import { RoundTimekeeperFactory } from '@/services/round/RoundTimekeeperFactory';
import { z } from 'zod';

export const judgeChooseWinner = async (app: App) => {
  const roomService = RoomServiceFactory();
  const timekeeper = RoundTimekeeperFactory();

  app.register(ensureAuth).post(
    '/:roomCode/winner',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Judge chooses a winner for the current round',
        body: z.object({
          winnerPlayerId: z.string()
        }),
        params: z.object({
          roomCode: z.string().min(6).max(6)
        }),
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async req => {
      const user = req.getUser();
      const { roomCode } = req.params;
      const { winnerPlayerId } = req.body;

      const { room, winner, winnerPlayer, gameEnded, ranking } =
        await roomService.processJudgeChooseWinner({
          roomCode,
          judgePlayerId: user.id,
          winnerPlayerId
        });

      await app.pubsub.publish(room.code, {
        event: 'room.round-end',
        payload: winner
      });

      // Broadcast the winner's new score — the played card carries only a bare
      // User, so the score travels via room.player-update. issue #1, slice 1.
      await app.pubsub.publish(room.code, {
        event: 'room.player-update',
        payload: winnerPlayer
      });

      // Win-condition: end the game instead of starting another Round.
      // issue #1, slice 2.
      if (gameEnded) {
        await app.pubsub.publish(room.code, {
          event: 'room.game-end',
          payload: ranking ?? []
        });

        return { success: true };
      }

      const nextRound = await roomService.startNextRound(room.code, room.round);

      // Start the next Round's play clock (ADR-0003): a Redis TTL key whose expiry
      // advances the Round so an AFK Player can't stall it. issue #4.
      await timekeeper.armPlayDeadline(nextRound.id);

      // No per-Round redeal: Hands persist and are refilled in playCards.
      // issue #1, slice 3.
      await app.pubsub.publish(room.code, {
        event: 'room.round-start',
        payload: {
          roundNumber: nextRound.roundNumber,
          blackCard: nextRound.blackCard
        }
      });

      return { success: true };
    }
  );
};
