import { ForbiddenError, NotFoundError } from '@/errors';
import { ROOM_ERRORS } from '@/errors/room';
import type { BlackCard } from '@/repositories/cards';
import type { IGameStore } from '@/repositories/game-store/IGameStore';
import { toRoomPlayer } from '@/schemas';
import type {
  Player,
  PublicRoomWithPlayerCountAndHost,
  Room,
  RoomPlayer,
  Round,
  RoundPlayedCard,
  RoundSnapshot,
  SanitizedRoom,
  WhiteCard
} from '@/schemas';
import type { IBlackCardDeck } from './IBlackCardDeck';

// Played Cards are shown to the whole Room from judging on, and stay visible
// once the Round completes so the winning answer can be shown. Before that
// nobody sees them, the Judge included: `room.time-to-judge` reveals them at the
// same moment. The played-cards endpoint used to show them to the Judge during
// PLAYING. issue #26.
const REVEALED_PHASES: Round['status'][] = ['JUDGING', 'COMPLETE'];

/**
 * Strip the password off a Room. The only place it is removed, shared by every
 * REST read and the `room.started` broadcast (ADR-0005). issue #26.
 *
 * @example
 * publish(roomCode, { event: 'room.started', payload: { room: toSanitizedRoom(room), players } });
 */
export function toSanitizedRoom({ password: _password, ...room }: Room): SanitizedRoom {
  return room;
}

/**
 * What a viewer may see of a Room: the sanitized Room, its Players as
 * RoomPlayer (no Hand, no stored Judge flag), the viewer's own Hand, the
 * current Black Card, the Round snapshot and the Played Cards under one
 * phase-aware reveal rule. Room and Players are open to any signed-in User (the
 * join prompt shows them); everything about the game in play needs membership.
 * Answer "is X exposed?" here. issue #26.
 *
 * @example
 * const view = new RoomView(store, new BlackCardDeck(store));
 * await view.hand('ABC123', user.id);
 */
export class RoomView {
  constructor(
    private readonly store: Pick<
      IGameStore,
      'rooms' | 'players' | 'rounds' | 'playedCards' | 'cards'
    >,
    private readonly deck: Pick<IBlackCardDeck, 'findBlackCard'>
  ) {}

  public async room(roomCode: string): Promise<SanitizedRoom> {
    return toSanitizedRoom(await this.requireRoom(roomCode));
  }

  public async publicRooms(): Promise<PublicRoomWithPlayerCountAndHost[]> {
    return await this.store.rooms.listPublicRooms();
  }

  public async players(roomCode: string): Promise<RoomPlayer[]> {
    await this.requireRoom(roomCode);
    const players = await this.store.players.getRoomPlayersByCode(roomCode);
    return players.map(toRoomPlayer);
  }

  // Only the viewer's own Hand, resolved from stored ids against the card pool.
  public async hand(roomCode: string, viewerId: string): Promise<WhiteCard[]> {
    await this.requireRoom(roomCode);
    const viewer = await this.requireMember(roomCode, viewerId);
    const hand = await Promise.all(
      viewer.cardIds.map(id => this.store.cards.findWhiteCardById(id))
    );
    return hand.filter((card): card is WhiteCard => card !== undefined);
  }

  // Read from the current Round, like the snapshot, so the two never disagree.
  // The Room's currentBlackCardId moves to the next card before that Round opens.
  public async blackCard(
    roomCode: string,
    viewerId: string
  ): Promise<BlackCard | null> {
    const { round } = await this.memberGame(roomCode, viewerId);
    return await this.blackCardOf(round);
  }

  public async playedCards(
    roomCode: string,
    viewerId: string
  ): Promise<RoundPlayedCard[]> {
    const { round } = await this.memberGame(roomCode, viewerId);
    return await this.revealedPlays(round);
  }

  // Everything a (re)connecting client needs to render the current Round. The
  // Judge is the Room's judgeId, like every other Judge read (ADR-0005).
  public async round(
    roomCode: string,
    viewerId: string
  ): Promise<RoundSnapshot | null> {
    const { room, round } = await this.memberGame(roomCode, viewerId);
    if (!round) {
      return null;
    }
    return {
      roundNumber: round.roundNumber,
      status: round.status,
      judgeId: room.judgeId ?? round.judgeId,
      playDeadline: round.playDeadline,
      judgeDeadline: round.judgeDeadline,
      blackCard: await this.blackCardOf(round),
      roundPlayedCards: await this.revealedPlays(round)
    };
  }

  private async revealedPlays(round: Round | null): Promise<RoundPlayedCard[]> {
    if (!round || !REVEALED_PHASES.includes(round.status)) {
      return [];
    }
    return await this.store.playedCards.findByRoomCodeAndRoundNumber(
      round.roomCode,
      round.roundNumber
    );
  }

  private async blackCardOf(round: Round | null): Promise<BlackCard | null> {
    if (!round) {
      return null;
    }
    const card = await this.deck.findBlackCard(round.roomCode, round.blackCardId);
    return card ?? null;
  }

  // The Room and its current Round (null before the game starts), for a member.
  private async memberGame(
    roomCode: string,
    viewerId: string
  ): Promise<{ room: Room; round: Round | null }> {
    const room = await this.requireRoom(roomCode);
    await this.requireMember(roomCode, viewerId);
    return { room, round: await this.store.rounds.find(roomCode, room.round) };
  }

  private async requireRoom(roomCode: string): Promise<Room> {
    const room = await this.store.rooms.getRoomByCode(roomCode);
    if (!room) {
      throw new NotFoundError(ROOM_ERRORS.ROOM_NOT_FOUND);
    }
    return room;
  }

  private async requireMember(
    roomCode: string,
    viewerId: string
  ): Promise<Player> {
    const viewer = await this.store.players.getPlayerFromRoom(roomCode, viewerId);
    if (!viewer) {
      throw new ForbiddenError(
        `Você não está na sala ${roomCode} (usuário ${viewerId}); entre na sala para ver o jogo.`
      );
    }
    return viewer;
  }
}
