import type { CreateRoomDTO } from '@/dto/CreateRoom';
import type { JoinRoomDTO } from '@/dto/JoinRoom';
import type { LeaveRoomDTO } from '@/dto/LeaveRoom';
import type { BlackCard as DrawnBlackCard } from '@/repositories/cards';
import type {
  BlackCard,
  Player,
  PublicRoomWithPlayerCountAndHost,
  Ranking,
  Room,
  Round,
  RoundPlayedCard,
  RoundStatus,
  WhiteCard
} from '@/schemas';

export interface IRoomService {
  getRoom(roomCode: string): Promise<Room>;
  createRoom(room: CreateRoomDTO): Promise<Room>;
  listPublicRooms(): Promise<PublicRoomWithPlayerCountAndHost[]>;
  addPlayerToRoom(input: { roomCode: string; player: Player }): Promise<void>;
  startGame(roomCode: string, requesterId: string): Promise<GameStart>;
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
  togglePlayerReady(roomCode: string, playerId: string): Promise<Player>;
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
  ): Promise<PlayResult>;
  getRoundPlayedCards(
    roomCode: string,
    roundNumber: number
  ): Promise<RoundPlayedCard[]>;
  getActiveRound(roomCode: string): Promise<Round | null>;
  getRoundSnapshot(roomCode: string): Promise<RoundSnapshot | null>;
  getRoundNumber(roomCode: string): Promise<number>;
  checkJudgePick(data: JudgeChooseWinnerDTO): Promise<JudgePick>;
  scoreRoundWinner(room: Room, winnerPlayerId: string): Promise<RoundScore>;
  dealInitialHands(data: {
    roomCode: string;
    cardsPerPlayer: number;
  }): Promise<DealtHand[]>;
  dealHand(roomCode: string, playerId: string, count: number): Promise<WhiteCard[]>;
}

export type DealtHand = { playerId: string; cards: WhiteCard[] };

// A started game: the IN_PROGRESS Room, every Player (unready, Hands dealt),
// Round 1's Judge and Black Card, and each Player's Hand for their private
// channel. RoundLifecycle opens Round 1 from the Judge and Black Card (#25).
export type GameStart = {
  room: Room;
  players: Player[];
  judgeId: string;
  blackCard: DrawnBlackCard;
  hands: DealtHand[];
};

// A Player's accepted answer: the Player as stored afterwards (isReady true) and
// the White Cards dealt to refill their Hand.
export type PlayResult = { player: Player; cardsDrawn: WhiteCard[] };

// REST view of the current Round for a (re)connecting client. Played Cards are
// empty until the Round reaches judging.
export type RoundSnapshot = {
  roundNumber: number;
  status: RoundStatus;
  judgeId: string;
  playDeadline: Date | null;
  judgeDeadline: Date | null;
  blackCard: BlackCard | null;
  roundPlayedCards: RoundPlayedCard[];
};

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

// A Judge's pick that passed the rules: the Round being judged and the winning
// Played Card. RoundLifecycle claims the Round before scoring it (#25).
export type JudgePick = {
  room: Room;
  round: Round;
  winner: RoundPlayedCard;
};

// Outcome of scoring the pick. `winnerPlayer` carries the updated score for the
// `room.round-end` broadcast; when the win-condition is met `gameEnded` is
// true and `ranking` holds the final Ranking for `room.game-end`. See issue #1.
export type RoundScore = {
  winnerPlayer: Player;
  gameEnded: boolean;
  ranking: Ranking | null;
};
