import type { CreateRoomDTO } from '@/dto/CreateRoom';
import type { JoinRoomDTO } from '@/dto/JoinRoom';
import type { LeaveRoomDTO } from '@/dto/LeaveRoom';
import type {
  BlackCard,
  Player,
  PublicRoomWithPlayerCountAndHost,
  Ranking,
  Room,
  Round,
  RoundPlayedCard,
  RoundWithRelations,
  WhiteCard
} from '@/schemas';

export interface IRoomService {
  getRoom(roomCode: string): Promise<Room>;
  createRoom(room: CreateRoomDTO): Promise<Room>;
  listPublicRooms(): Promise<PublicRoomWithPlayerCountAndHost[]>;
  addPlayerToRoom(input: { roomCode: string; player: Player }): Promise<void>;
  startRoom(roomCode: string): Promise<void>;
  endGame(roomCode: string): Promise<Ranking>;
  joinRoom(input: JoinRoomDTO): Promise<Room>;
  leaveRoom(input: LeaveRoomDTO): Promise<void>;
  getPlayerRoomCodes(playerId: string): Promise<string[]>;
  handleHostLoss(
    roomCode: string,
    departingPlayerId: string
  ): Promise<HostLossOutcome>;
  setPlayerActive(
    roomCode: string,
    playerId: string,
    isActive: boolean
  ): Promise<Player>;
  allActivePlayersPlayed(roomCode: string): Promise<boolean>;
  getRoomPlayers(roomCode: string): Promise<Player[]>;
  getRoomBlackCardId(roomCode: string): Promise<string | null>;
  updatePlayerInRoom(
    roomCode: string,
    playerId: string,
    payload: Partial<Player>
  ): Promise<Player>;
  getPlayerFromRoom(roomCode: string, playerId: string): Promise<Player>;
  incrementPlayerScore(input: {
    roomCode: string;
    playerId: string;
    by: number;
  }): Promise<void>;
  updateRoom(roomCode: string, data: Partial<Room>): Promise<Room>;
  getCurrentWhiteCards(
    roomCode: string,
    playerId: string
  ): Promise<WhiteCard[]>;
  setPlayersAsUnready(roomCode: string): Promise<void>;
  playCards(
    roomCode: string,
    playerId: string,
    playedCardIds: string[]
  ): Promise<WhiteCard[]>;
  createRound(data: CreateRoundDTO): Promise<Round>;
  startNextRound(
    roomCode: string,
    currentRound: number
  ): Promise<RoundWithRelations & { blackCard: BlackCard }>;
  getRoundPlayedCards(
    roomCode: string,
    roundNumber: number
  ): Promise<RoundPlayedCard[]>;
  getRoundNumber(roomCode: string): Promise<number>;
  judgeChooseWinner(data: JudgeChooseWinnerDTO): Promise<RoundPlayedCard>;
  processJudgeChooseWinner(data: JudgeChooseWinnerDTO): Promise<JudgePickResult>;
  dealInitialHands(data: {
    roomCode: string;
    cardsPerPlayer: number;
  }): Promise<
    {
      playerId: string;
      cards: WhiteCard[];
    }[]
  >;
}

// Outcome of a Host departing (explicit Leave or a connection drop), branched on
// Room status per ADR-0002. Drives the Room-level broadcast: the Room either ends
// (always in LOBBY; in IN_PROGRESS only when no active Players remain) or the Host
// role moves to an active Player. `not-host` means the departing Player was not the
// Host, so nothing changed. See issue #3.
export type HostLossOutcome =
  | { kind: 'not-host' }
  | { kind: 'room-ended'; ranking: Ranking }
  | { kind: 'host-reassigned'; newHost: Player };

export type JudgeChooseWinnerDTO = {
  winnerPlayerId: string;
  judgePlayerId: string;
  roomCode: string;
};

// Outcome of the Judge's pick. `winnerPlayer` carries the updated score for the
// `room.player-update` broadcast; when the win-condition is met `gameEnded` is
// true and `ranking` holds the final Ranking for `room.game-end`. See issue #1.
export type JudgePickResult = {
  room: Room;
  winner: RoundPlayedCard;
  winnerPlayer: Player;
  gameEnded: boolean;
  ranking: Ranking | null;
};
