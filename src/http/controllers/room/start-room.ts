import type { App } from '@/app';
import { ROOM_ERRORS } from '@/errors/room';
import { ensureAuth } from '@/plugins/ensure-auth';
import { CardServiceFactory } from '@/services/CardServiceFactory';
import { RoomServiceFactory } from '@/services/room/RoomServiceFactory';
import { RoundTimekeeperFactory } from '@/services/round/RoundTimekeeperFactory';
import { getRandomJudge } from '@/utils/getRandomJudge';
import { toRoomPlayer } from '@/schemas';
import { startRoom } from '@/contracts';

// TODO: refactor this controller, it's doing business logic
// it should be in the service layer
export const startRoomController = async (app: App) => {
  const roomService = RoomServiceFactory();
  const timekeeper = RoundTimekeeperFactory();

  app.register(ensureAuth).post(
    '/start',
    {
      schema: {
        tags: ['Rooms'],
        description: 'Start a room',
        security: [{ cookieAuth: [], bearerAuth: [] }]
      }
    },
    async (req, res) => {
      const user = req.getUser();

      const { roomCode } = startRoom.parse(req.body);
      const cardService = CardServiceFactory(roomCode);
      let room = await roomService.getRoom(roomCode);

      if (user.id !== room.hostId) {
        return res.badRequest(ROOM_ERRORS.IS_NOT_ROOM_HOST);
      }

      const players = await roomService.getRoomPlayers(roomCode);
      const judgeId = getRandomJudge(room.prevJudgeId, players);

      // Judge identity lives on room.judgeId; no per-Player is_judge to write —
      // every read derives isJudge from it (ADR-0005).
      room = await roomService.updateRoom(roomCode, {
        judgeId,
        status: 'IN_PROGRESS',
        round: room.round + 1
      });

      // Every Player is unready at the start of a Round — reflect it in the
      // snapshot below before we broadcast it.
      await roomService.setPlayersAsUnready(roomCode);

      // Seed the whole IN_PROGRESS state in one self-contained message: the
      // sanitized Room (never broadcast the password) plus every Player's public
      // state as a RoomPlayer (no private Hand, no derived isJudge). Replaces the
      // old per-Player update loop and the dead room.black-card-drawn. ADR-0005.
      const { password: _password, ...sanitizedRoom } = room;
      await app.pubsub.publish(roomCode, {
        event: 'room.started',
        payload: {
          room: sanitizedRoom,
          players: players.map(player => toRoomPlayer({ ...player, isReady: false }))
        }
      });

      const blackCard = await cardService.getNewBlackCard();
      // card service already updates the black card in the db, this is just
      // to make sure the room object is up to date
      room.currentBlackCardId = blackCard.id;

      // Deal a starting Hand to EVERY Player, including the first Judge — Hands
      // persist across Rounds and refill in playCards. issue #1, slice 3. Each
      // Hand goes only to its owner's private Player channel.
      const initialHands = await roomService.dealInitialHands({
        roomCode,
        cardsPerPlayer: 10
      });

      for (const hand of initialHands) {
        await app.pubsub.publish(hand.playerId, {
          event: 'player.cards-drawn',
          payload: hand.cards
        });
      }

      const round = await roomService.createRound({
        blackCardId: room.currentBlackCardId,
        judgeId,
        roomCode,
        roundNumber: room.round,
        roundWinnerId: null
      });

      // Start the first Round's play clock (ADR-0003): expiry advances the Round
      // so an AFK Player can't stall the game. issue #4.
      await timekeeper.armPlayDeadline(round.id);

      await app.pubsub.publish(roomCode, {
        event: 'room.round-start',
        payload: {
          roundNumber: round.roundNumber,
          judgeId,
          blackCard
        }
      });

      res.status(204);
    }
  );
};
