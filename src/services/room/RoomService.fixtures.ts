import type { BlackCard } from '@/repositories/cards';
import type { Player, Room, Round, RoundPlayedCard } from '@/schemas';
import {
  FakeBlackCardDeck,
  FakeRankingRepository,
  FakeRoomPlayersRepository,
  FakeRoomRepository,
  FakeRoundPlayedCardsRepository,
  FakeRoundRepository,
  FakeWhiteCardDealer
} from './RoomService.fakes';
import { RoomService } from './RoomService';

// Shared builders for the RoomService specs: one in-memory Room wired to named
// fakes, seeded through buildService.

export const ROOM_CODE = 'ABC123';

export function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-1',
    username: 'player-1',
    avatarUrl: null,
    isHost: false,
    isReady: false,
    isJudge: false,
    isActive: true,
    score: 0,
    cardIds: [],
    ...overrides
  };
}

export function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    code: ROOM_CODE,
    maxPlayers: 10,
    maxPoints: 5,
    status: 'IN_PROGRESS',
    hostId: 'player-judge',
    password: null,
    isPublic: true,
    prevJudgeId: null,
    judgeId: 'player-judge',
    round: 1,
    pickedWhiteCards: [],
    pickedBlackCards: [],
    currentBlackCardId: 'black-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

export function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: 'round-1',
    roomCode: ROOM_CODE,
    roundNumber: 1,
    blackCardId: 'black-1',
    judgeId: 'player-judge',
    roundWinnerId: null,
    status: 'PLAYING',
    playDeadline: null,
    judgeDeadline: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

export function makePlayedCard(playerId: string): RoundPlayedCard {
  return {
    id: `played-${playerId}`,
    roundId: 'round-1',
    player: {
      id: playerId,
      username: playerId,
      avatarUrl: null
    },
    whiteCards: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

export type Fakes = {
  room: FakeRoomRepository;
  players: FakeRoomPlayersRepository;
  ranking: FakeRankingRepository;
  rounds: FakeRoundRepository;
  playedCards: FakeRoundPlayedCardsRepository;
  dealer: FakeWhiteCardDealer;
  deck: FakeBlackCardDeck;
};

export function buildService(args: {
  room: Room;
  players: Player[];
  rounds: Round[];
  playedCards: RoundPlayedCard[];
  blackCards?: BlackCard[];
}): { service: RoomService; fakes: Fakes } {
  const players = new FakeRoomPlayersRepository(args.players);
  const fakes: Fakes = {
    room: new FakeRoomRepository(args.room),
    players,
    ranking: new FakeRankingRepository(players),
    rounds: new FakeRoundRepository(args.rounds),
    playedCards: new FakeRoundPlayedCardsRepository(args.playedCards),
    dealer: new FakeWhiteCardDealer(),
    deck: new FakeBlackCardDeck(args.blackCards)
  };

  const service = new RoomService(
    fakes.room,
    fakes.ranking,
    fakes.players,
    fakes.rounds,
    fakes.playedCards,
    fakes.dealer,
    fakes.deck
  );

  return { service, fakes };
}
