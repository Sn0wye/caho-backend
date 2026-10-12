import type { CreateRoom } from '@/contracts';
import { BadRequestError } from '@/errors';
import { ROOM_ERRORS } from '@/errors/room';
import type { Ranking, Room, SanitizedRoom } from '@/schemas';
import type { IGameEventPublisher } from '@/services/IGameEventPublisher';
import type { RoundLifecycle } from '@/services/round/RoundLifecycle';
import type { Logger } from 'pino';
import type { IRoomOrchestratorService } from './IRoomOrchestratorService';
import type { GameStart } from './IRoomService';
import { toRoomPlayer, toSanitizedRoom } from './RoomView';
import { HAND_SIZE } from './gameRules';
import { type PlayerProfile, playerFromUser } from './playerFromUser';

// A signed-in User asking to join a Room.
export type JoinRoomCommand = {
  roomCode: string;
  password: string | null;
  user: PlayerProfile;
};

// Orchestrates Room membership and lifecycle (join, ready, leave, start, end,
// presence) and owns the broadcasts that follow. Pulled out of the Fastify
// controllers and the WS handler so HTTP/WS only parse in/serialize out, and the
// status-dependent Host fallout lives in one tested place shared by the REST
// Leave path and the WebSocket drop path. Presence changes are passed on to
// RoundLifecycle, which decides what they mean for the Round (#25). Emission
// lives here or in RoundLifecycle, never in a controller. ADR-0004.
export class RoomOrchestrator {
  constructor(
    private readonly rooms: IRoomOrchestratorService,
    private readonly rounds: RoundLifecycle,
    private readonly publisher: IGameEventPublisher,
    private readonly log?: Logger
  ) {}

  // Create a Room and seat its creator as Host, in one call so the create-room
  // controller no longer sequences two RoomService calls itself. issue #26.
  public async createRoom(
    settings: CreateRoom,
    host: PlayerProfile
  ): Promise<SanitizedRoom> {
    const room = await this.rooms.createRoom({ ...settings, hostId: host.id });
    await this.rooms.addPlayerToRoom({
      roomCode: room.code,
      player: playerFromUser(host, true)
    });
    this.log?.info(
      { event: 'room.created', roomCode: room.code, userId: host.id },
      'Room created'
    );
    return toSanitizedRoom(room);
  }

  public async joinRoom({
    roomCode,
    password,
    user
  }: JoinRoomCommand): Promise<SanitizedRoom> {
    const player = playerFromUser(user, false);
    const room = await this.rooms.joinRoom({ roomCode, password, player });
    await this.publisher.publish(roomCode, {
      event: 'room.player-joined',
      payload: toRoomPlayer(player)
    });
    await this.dealLateJoiner(room, player.id);
    this.log?.info(
      { event: 'room.player_joined', roomCode: room.code, playerId: player.id },
      'Player joined Room'
    );
    return toSanitizedRoom(room);
  }

  // A Player joining an in-progress game would otherwise hold no cards; they play
  // from the current Round on. The Hand also stays fetchable over REST.
  private async dealLateJoiner(room: Room, playerId: string): Promise<void> {
    if (room.status !== 'IN_PROGRESS') {
      return;
    }
    const cards = await this.rooms.dealHand(room.code, playerId, HAND_SIZE);
    await this.publisher.publish(playerId, {
      event: 'player.cards-drawn',
      payload: cards
    });
  }

  // Lobby ready toggle; RoomService rejects it outside LOBBY. Broadcast the
  // change to the Room.
  public async playerReady(roomCode: string, playerId: string): Promise<void> {
    const player = await this.rooms.togglePlayerReady(roomCode, playerId);
    await this.publisher.publish(roomCode, {
      event: 'room.player-update',
      payload: toRoomPlayer(player)
    });
  }

  // The Host starts the game. Seeds the whole IN_PROGRESS state in one
  // self-contained message (sanitized Room — never the password — plus every
  // Player as a RoomPlayer), sends each Hand only to its owner, then has
  // RoundLifecycle open and announce Round 1. Was inline in the start-room
  // controller; emission belongs here (ADR-0004/0005).
  public async startRoom(roomCode: string, requesterId: string): Promise<void> {
    const start = await this.rooms.startGame(roomCode, requesterId);

    await this.publisher.publish(roomCode, {
      event: 'room.started',
      payload: {
        room: toSanitizedRoom(start.room),
        players: start.players.map(toRoomPlayer)
      }
    });
    await this.publishHands(start);
    const round = await this.rounds.startFirstRound(
      roomCode,
      start.judgeId,
      start.blackCard
    );
    this.log?.info(
      {
        event: 'room.started',
        roomCode,
        roundId: round.id,
        playerCount: start.players.length
      },
      'Room started'
    );
  }

  private async publishHands(start: GameStart): Promise<void> {
    for (const hand of start.hands) {
      await this.publisher.publish(hand.playerId, {
        event: 'player.cards-drawn',
        payload: hand.cards
      });
    }
  }

  // Explicit Leave: remove the Player, announce it, then resolve the Host and
  // Round fallout. The Room's hostId/judgeId outlive the deleted Player row, so the
  // departure reads still resolve correctly here. issue #3 / ADR-0002.
  public async leaveRoom(roomCode: string, playerId: string): Promise<void> {
    await this.rooms.leaveRoom({ roomCode, playerId });
    await this.publisher.publish(roomCode, {
      event: 'room.player-left',
      payload: { id: playerId }
    });
    await this.broadcastHostDeparture(roomCode, playerId);
    await this.rounds.onPlayerLeft(roomCode, playerId);
    this.log?.info(
      { event: 'room.player_left', roomCode, playerId },
      'Player left Room'
    );
  }

  // End the game for the Host. Same end-of-game path as the maxPoints win-condition,
  // and notify WS subscribers. Returns the final Ranking for the HTTP body. issue #1.
  public async endRoom(
    roomCode: string,
    requesterId: string
  ): Promise<Ranking> {
    const { hostId } = await this.rooms.getRoom(roomCode);
    if (requesterId !== hostId) {
      throw new BadRequestError(ROOM_ERRORS.IS_NOT_ROOM_HOST);
    }

    await this.rounds.endActiveRound(roomCode);
    const ranking = await this.rooms.endGame(roomCode);
    await this.publisher.publish(roomCode, {
      event: 'room.game-end',
      payload: ranking
    });
    this.log?.info(
      { event: 'room.ended', roomCode, reason: 'host' },
      'Room ended'
    );
    return ranking;
  }

  // Presence change for one Room (ADR-0002): broadcast the Player's active flag,
  // resolve the Host fallout of a drop, and tell RoundLifecycle (a dropped Judge
  // holds the Round on grace rather than aborting it).
  public async markPresence(
    roomCode: string,
    playerId: string,
    isActive: boolean
  ): Promise<void> {
    const player = await this.rooms.setPlayerActive(
      roomCode,
      playerId,
      isActive
    );
    this.log?.debug(
      { event: 'room.presence_changed', roomCode, playerId, isActive },
      'Player presence changed'
    );
    await this.publisher.publish(roomCode, {
      event: 'room.player-update',
      payload: toRoomPlayer(player)
    });

    if (isActive) {
      await this.rounds.onPlayerReturned(roomCode, playerId);
      return;
    }

    await this.handleHostDrop(roomCode, playerId);
    await this.rounds.onPlayerDropped(roomCode, playerId);
  }

  // A dropped socket is not a Leave (ADR-0002). In LOBBY there is no game to keep
  // alive, so a Host refresh (or React StrictMode's mount/unmount/mount in dev)
  // used to end the Room for everyone. Keep the Host; they stay Inactive until
  // they reconnect. IN_PROGRESS still hands Host to an active Player (issue #3).
  private async handleHostDrop(roomCode: string, playerId: string): Promise<void> {
    const room = await this.rooms.getRoom(roomCode);
    if (room.status === 'LOBBY') {
      return;
    }
    await this.broadcastHostDeparture(roomCode, playerId);
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
      this.log?.info(
        {
          event: 'room.host_reassigned',
          roomCode,
          playerId: outcome.newHost.id
        },
        'Room Host reassigned'
      );
      await this.publisher.publish(roomCode, {
        event: 'room.player-update',
        payload: toRoomPlayer(outcome.newHost)
      });
      return;
    }

    if (outcome.kind === 'room-ended') {
      await this.rounds.endActiveRound(roomCode);
      this.log?.info(
        { event: 'room.ended', roomCode, reason: 'host_departed' },
        'Room ended after Host departure'
      );
      await this.publisher.publish(roomCode, {
        event: 'room.game-end',
        payload: outcome.ranking
      });
    }
  }
}
