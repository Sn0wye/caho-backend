import type { JoinRoomDTO } from '@/dto/JoinRoom';
import { BadRequestError } from '@/errors';
import { ROOM_ERRORS } from '@/errors/room';
import type { IGameEventPublisher } from '@/services/IGameEventPublisher';
import type { IJudgeClock } from '@/services/round/IJudgeClock';
import { toRoomPlayer } from '@/schemas';
import type { Ranking, Room } from '@/schemas';
import type { IRoomOrchestratorService } from './IRoomOrchestratorService';

// Departure mode: an explicit Leave aborts the Round and rotates the Judge now; a
// connection drop holds the Round on the grace timer awaiting reconnect. ADR-0002.
type DepartureMode = 'leave' | 'drop';

// Orchestrates Room membership and lifecycle (join, leave, end, presence) and owns
// the broadcasts that follow. Pulled out of the Fastify controllers and the WS
// handler so HTTP/WS only parse in/serialize out, and the status-dependent Host /
// Judge departure fallout lives in one tested place shared by the REST Leave path
// and the WebSocket drop path. Emission lives here, never in a controller. ADR-0004.
export class RoomOrchestrator {
  constructor(
    private readonly rooms: IRoomOrchestratorService,
    private readonly judgeClock: IJudgeClock,
    private readonly publisher: IGameEventPublisher
  ) {}

  public async joinRoom(input: JoinRoomDTO): Promise<Room> {
    const room = await this.rooms.joinRoom(input);
    await this.publisher.publish(input.roomCode, {
      event: 'room.player-joined',
      payload: toRoomPlayer(input.player)
    });
    return room;
  }

  // Explicit Leave: remove the Player, announce it, then resolve the Host and Judge
  // fallout. The Room's hostId/judgeId outlive the deleted Player row, so the
  // departure reads still resolve correctly here. issue #3 / ADR-0002.
  public async leaveRoom(roomCode: string, playerId: string): Promise<void> {
    await this.rooms.leaveRoom({ roomCode, playerId });
    await this.publisher.publish(roomCode, {
      event: 'room.player-left',
      payload: { id: playerId }
    });
    await this.broadcastHostDeparture(roomCode, playerId);
    await this.handleJudgeDeparture(roomCode, playerId, 'leave');
  }

  // End the game for the Host. Same end-of-game path as the maxPoints win-condition,
  // and notify WS subscribers. Returns the final Ranking for the HTTP body. issue #1.
  public async endRoom(roomCode: string, requesterId: string): Promise<Ranking> {
    const { hostId } = await this.rooms.getRoom(roomCode);
    if (requesterId !== hostId) {
      throw new BadRequestError(ROOM_ERRORS.IS_NOT_ROOM_HOST);
    }

    const ranking = await this.rooms.endGame(roomCode);
    await this.publisher.publish(roomCode, {
      event: 'room.game-end',
      payload: ranking
    });
    return ranking;
  }

  // Presence change for one Room (ADR-0002): broadcast the Player's active flag, and
  // on a drop resolve the same Host/Judge fallout as a Leave — a drop holds the
  // Round on grace rather than aborting. A reconnect only re-activates.
  public async markPresence(
    roomCode: string,
    playerId: string,
    isActive: boolean
  ): Promise<void> {
    const player = await this.rooms.setPlayerActive(roomCode, playerId, isActive);
    await this.publisher.publish(roomCode, {
      event: 'room.player-update',
      payload: toRoomPlayer(player)
    });

    if (isActive) {
      return;
    }

    await this.broadcastHostDeparture(roomCode, playerId);
    await this.handleJudgeDeparture(roomCode, playerId, 'drop');
  }

  public playerRoomCodes(playerId: string): Promise<string[]> {
    return this.rooms.getPlayerRoomCodes(playerId);
  }

  // Map the status-dependent Host-loss outcome to its broadcast: a reassignment
  // carries the new Host as room.player-update; a Room-end reuses room.game-end with
  // the final Ranking. `not-host` is silent. (Was http/broadcastHostLoss.) issue #3.
  private async broadcastHostDeparture(
    roomCode: string,
    playerId: string
  ): Promise<void> {
    const outcome = await this.rooms.handleHostLoss(roomCode, playerId);

    if (outcome.kind === 'host-reassigned') {
      await this.publisher.publish(roomCode, {
        event: 'room.player-update',
        payload: toRoomPlayer(outcome.newHost)
      });
      return;
    }

    if (outcome.kind === 'room-ended') {
      await this.publisher.publish(roomCode, {
        event: 'room.game-end',
        payload: outcome.ranking
      });
    }
  }

  // Resolve a departing Judge: nothing happens unless the Player actually holds the
  // Judge role in an in-progress Round. A drop arms the grace timer; an explicit
  // Leave expires it now to abort+rotate. (Was http/handleJudgeLoss.) ADR-0002/0003.
  private async handleJudgeDeparture(
    roomCode: string,
    playerId: string,
    mode: DepartureMode
  ): Promise<void> {
    const room = await this.rooms.getRoom(roomCode);
    if (room.status !== 'IN_PROGRESS' || room.judgeId !== playerId) {
      return;
    }

    const round = await this.rooms.getActiveRound(roomCode);
    if (!round) {
      return;
    }

    if (mode === 'drop') {
      await this.judgeClock.armJudgeGrace(round.id);
      return;
    }

    await this.judgeClock.onJudgeExpired(round.id);
  }
}
