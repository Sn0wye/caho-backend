import { toRoomPlayer } from '@/schemas';
import type { IGameEventPublisher } from '@/services/IGameEventPublisher';
import type { Logger } from 'pino';
import type { IRoundClock } from './IRoundClock';
import type { IRoundFlowService } from './IRoundFlowService';

// Orchestrates the in-Round player actions (play, judge-pick, ready): runs the
// domain step on RoomService, then broadcasts the resulting events. Pulled out of
// the Fastify controllers so HTTP only parses in/serializes out and the event
// mapping is unit-testable with a fake publisher. Emission lives here, never in a
// controller. See ADR-0004.
export class RoundFlow {
  constructor(
    private readonly rooms: IRoundFlowService,
    private readonly clock: IRoundClock,
    private readonly publisher: IGameEventPublisher,
    private readonly log?: Logger
  ) {}

  // A Player submits their answer for the current Round. Broadcasts the Player's
  // ready flag to the Room and the refilled Hand back to that Player, then — once
  // every active Player has played — advances to judging through the single
  // guarded transition (shared with the deadline path) so the Judge is prompted
  // exactly once. issue #1 / ADR-0004.
  public async playCards(
    roomCode: string,
    playerId: string,
    playedCardIds: string[]
  ): Promise<void> {
    // The play rules (phase, Judge, Hand, pick count) are enforced in the domain
    // step; it returns the Player as stored after the play.
    const { player, cardsDrawn } = await this.rooms.playCards(
      roomCode,
      playerId,
      playedCardIds
    );
    this.log?.debug(
      {
        event: 'round.cards_played',
        roomCode,
        playerId,
        playedCount: playedCardIds.length
      },
      'Player played cards'
    );

    await this.publisher.publish(roomCode, {
      event: 'room.player-update',
      payload: toRoomPlayer(player)
    });
    await this.publisher.publish(player.id, {
      event: 'player.cards-drawn',
      payload: cardsDrawn
    });

    // Only active Players are awaited; an Inactive Player never blocks the Round
    // from reaching judging (ADR-0002).
    if (!(await this.rooms.allActivePlayersPlayed(roomCode))) {
      return;
    }

    const round = await this.rooms.getActiveRound(roomCode);
    if (!round) {
      return;
    }

    const plays = await this.rooms.getRoundPlayedCards(
      roomCode,
      round.roundNumber
    );
    await this.clock.advanceToJudging(round, plays);
  }

  // The Judge picks a winner: score the winner, broadcast the round end carrying
  // the winner's new score, then either end the game (win-condition) or start the next
  // Round and arm its play clock. issue #1 / #4 / ADR-0004.
  public async judgePick(
    roomCode: string,
    judgePlayerId: string,
    winnerPlayerId: string
  ): Promise<void> {
    const { room, winner, winnerPlayer, gameEnded, ranking } =
      await this.rooms.processJudgeChooseWinner({
        roomCode,
        judgePlayerId,
        winnerPlayerId
      });
    this.log?.info(
      {
        event: 'round.winner_picked',
        roomCode: room.code,
        roundNumber: room.round,
        winnerId: winnerPlayer.id,
        newScore: winnerPlayer.score
      },
      'Judge picked Round winner'
    );

    // One self-contained round end: the winning Played Card plus the winner's new
    // score (the card carries only a bare User and can't hold the score). The
    // frontend applies the whole outcome from this single message. ADR-0005.
    await this.publisher.publish(room.code, {
      event: 'room.round-end',
      payload: {
        roundNumber: room.round,
        winner,
        winnerId: winnerPlayer.id,
        newScore: winnerPlayer.score,
        reason: 'picked'
      }
    });

    if (gameEnded) {
      this.log?.info(
        { event: 'room.ended', roomCode: room.code, reason: 'max_points' },
        'Room ended at maxPoints'
      );
      await this.publisher.publish(room.code, {
        event: 'room.game-end',
        payload: ranking ?? []
      });
      return;
    }

    const nextRound = await this.rooms.startNextRound(room.code, room.round);
    this.log?.info(
      {
        event: 'round.started',
        roomCode: room.code,
        roundId: nextRound.id,
        roundNumber: nextRound.roundNumber
      },
      'Next Round started'
    );

    // Start the next Round's play clock (ADR-0003): a Redis TTL key whose expiry
    // advances the Round so an AFK Player can't stall it. issue #4.
    await this.clock.armPlayDeadline(nextRound.id);

    // Hands persist and are refilled in playCards — no per-Round redeal. issue #1.
    await this.publisher.publish(room.code, {
      event: 'room.round-start',
      payload: {
        roundNumber: nextRound.roundNumber,
        judgeId: nextRound.judgeId,
        blackCard: nextRound.blackCard
      }
    });
  }

  // Toggle a Player's ready flag in the lobby and broadcast the change. The
  // domain step rejects it outside LOBBY.
  public async playerReady(roomCode: string, playerId: string): Promise<void> {
    const player = await this.rooms.togglePlayerReady(roomCode, playerId);

    await this.publisher.publish(roomCode, {
      event: 'room.player-update',
      payload: toRoomPlayer(player)
    });
  }
}
