import type { IRankingRepository } from '@/repositories/ranking';
import type { IRoomRepository } from '@/repositories/room';
import type { IRoomPlayersRepository } from '@/repositories/room-players';
import type { IRoundRepository } from '@/repositories/round';
import type { IRoundPlayedCardsRepository } from '@/repositories/round-played-cards';
import type { CreateRoundPlayedCardDTO } from '@/dto/CreateRoundPlayedCard';
import type {
  Player,
  PublicRoomWithPlayerCountAndHost,
  Ranking,
  Room,
  Round,
  RoundPlayedCard,
  RoundStatus,
  WhiteCard
} from '@/schemas';
import type { BlackCard } from '@/repositories/cards';
import type { IBlackCardDeck } from './IBlackCardDeck';
import type { IWhiteCardDealer } from './IWhiteCardDealer';

// Named in-memory fakes for RoomService unit tests. They model a single Room so
// specs stay readable: seed players/rounds/played-cards through the constructor,
// then assert on the mutated state. See issue #1.

export class FakeRoomRepository implements IRoomRepository {
  constructor(private room: Room) {}

  async getRoomByCode(roomCode: string): Promise<Room | undefined> {
    return this.room.code === roomCode ? this.room : undefined;
  }

  async create(data: Room): Promise<Room> {
    this.room = data;
    return data;
  }

  async listPublicRooms(): Promise<PublicRoomWithPlayerCountAndHost[]> {
    return [];
  }

  // The real repo keys on Code and silently updates nothing for any other key.
  // Mirror that, so a caller passing room.id (the bug that froze round numbers
  // and Host reassignment) fails here too.
  async update(roomCode: string, data: Partial<Room>): Promise<Room> {
    if (roomCode !== this.room.code) {
      return undefined as unknown as Room;
    }
    this.room = { ...this.room, ...data };
    return this.room;
  }
}

export class FakeRoomPlayersRepository implements IRoomPlayersRepository {
  private players: Map<string, Player>;

  constructor(players: Player[]) {
    this.players = new Map(players.map(player => [player.id, player]));
  }

  async getRoomPlayersByCode(_roomCode: string): Promise<Player[]> {
    return [...this.players.values()];
  }

  async addPlayerToRoom(input: {
    roomCode: string;
    player: Player;
  }): Promise<void> {
    this.players.set(input.player.id, input.player);
  }

  async getPlayerFromRoom(
    _roomCode: string,
    playerId: string
  ): Promise<Player | undefined> {
    return this.players.get(playerId);
  }

  async getRoomCodesByPlayerId(_playerId: string): Promise<string[]> {
    return [];
  }

  async updatePlayerInRoom(
    _roomCode: string,
    playerId: string,
    payload: Partial<Player>
  ): Promise<void> {
    const existing = this.players.get(playerId);
    if (!existing) {
      throw new Error(`Fake has no player to update: ${playerId}`);
    }
    this.players.set(playerId, { ...existing, ...payload });
  }

  async updatePlayers(_roomCode: string, players: Player[]): Promise<Player[]> {
    for (const player of players) {
      this.players.set(player.id, player);
    }
    return players;
  }

  async setPlayersAsUnready(_roomCode: string): Promise<void> {
    for (const [id, player] of this.players) {
      this.players.set(id, { ...player, isReady: false });
    }
  }

  async incrementPlayerScore(input: {
    roomCode: string;
    playerId: string;
    by: number;
  }): Promise<void> {
    const existing = this.players.get(input.playerId);
    if (!existing) {
      throw new Error(`Fake has no player to score: ${input.playerId}`);
    }
    this.players.set(input.playerId, {
      ...existing,
      score: existing.score + input.by
    });
  }

  async deletePlayerFromRoom(
    _roomCode: string,
    playerId: string
  ): Promise<void> {
    this.players.delete(playerId);
  }
}

export class FakeRoundRepository implements IRoundRepository {
  private rounds: Round[];

  constructor(rounds: Round[] = []) {
    this.rounds = [...rounds];
  }

  async create(input: Round): Promise<Round> {
    this.rounds.push(input);
    return input;
  }

  async find(roomCode: string, number: number): Promise<Round | null> {
    return (
      this.rounds.find(
        round => round.roomCode === roomCode && round.roundNumber === number
      ) ?? null
    );
  }

  async update(id: string, data: Partial<Round>): Promise<Round | null> {
    const index = this.rounds.findIndex(round => round.id === id);
    if (index === -1) {
      return null;
    }
    this.rounds[index] = { ...this.rounds[index], ...data };
    return this.rounds[index];
  }

  async claimAdvance(
    id: string,
    from: RoundStatus | RoundStatus[],
    to: RoundStatus
  ): Promise<Round | null> {
    const allowed = Array.isArray(from) ? from : [from];
    const round = this.rounds.find(candidate => candidate.id === id);
    if (!round || !allowed.includes(round.status)) {
      return null;
    }
    return this.update(id, { status: to });
  }

  all(): Round[] {
    return [...this.rounds];
  }
}

export class FakeRoundPlayedCardsRepository
  implements IRoundPlayedCardsRepository
{
  constructor(private playedCards: RoundPlayedCard[] = []) {}

  public readonly created: CreateRoundPlayedCardDTO[] = [];

  async create(
    data: CreateRoundPlayedCardDTO
  ): Promise<Omit<RoundPlayedCard, 'player' | 'whiteCards'>> {
    this.created.push(data);
    const created = {
      id: `played-${this.playedCards.length + 1}`,
      roundId: data.roundId,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    return created;
  }

  async findByRoomCodeAndRoundNumber(
    _roomCode: string,
    _roundNumber: number
  ): Promise<RoundPlayedCard[]> {
    return this.playedCards;
  }
}

export class FakeRankingRepository implements IRankingRepository {
  constructor(private playersRepo: FakeRoomPlayersRepository) {}

  async getRankingByRoomCode(roomCode: string): Promise<Ranking> {
    const players = await this.playersRepo.getRoomPlayersByCode(roomCode);
    return players
      .slice()
      .sort((a, b) => b.score - a.score)
      .map(player => ({
        id: player.id,
        username: player.username,
        avatarUrl: player.avatarUrl,
        score: player.score
      }));
  }
}

// Deals deterministic, uniquely-ided White Cards so refill assertions are stable.
export class FakeWhiteCardDealer implements IWhiteCardDealer {
  private dealt = 0;

  async dealWhiteCards(_roomCode: string, count: number): Promise<WhiteCard[]> {
    return Array.from({ length: count }, () => {
      this.dealt += 1;
      return {
        id: `dealt-${this.dealt}`,
        text: `dealt card ${this.dealt}`,
        packId: 'fake-pack'
      };
    });
  }
}

// Hands out Black Cards in order and records draws; lookups resolve against the
// seeded pool so a Round's `pick` can be controlled per spec.
export class FakeBlackCardDeck implements IBlackCardDeck {
  private drawn = 0;

  constructor(private readonly cards: BlackCard[] = []) {}

  async drawBlackCard(_roomCode: string): Promise<BlackCard> {
    this.drawn += 1;
    const card = { id: `black-drawn-${this.drawn}`, text: 'drawn', pick: 1, packId: 'fake-pack' };
    this.cards.push(card);
    return card;
  }

  async findBlackCard(
    _roomCode: string,
    id: string
  ): Promise<BlackCard | undefined> {
    return this.cards.find(card => card.id === id);
  }
}
