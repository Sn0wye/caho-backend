import type { CreateRoundPlayedCardDTO } from '@/dto/CreateRoundPlayedCard';
import type { IRoundPlayedCardsRepository } from '@/repositories/round-played-cards';
import type { Round, RoundPlayedCard, WhiteCard } from '@/schemas';
import {
  type InMemoryGameTables,
  type PlayRow,
  cloneRow
} from './InMemoryGameTables';

// round_played_cards + its ordered white-card pivot. Writes enforce the same
// keys as Postgres (one answer per Round and Player, real Round/User/White
// Cards); reads join the Player's public profile and the cards in play order.
export class InMemoryRoundPlayedCardsRepository
  implements IRoundPlayedCardsRepository
{
  private nextId = 1;

  constructor(private readonly tables: InMemoryGameTables) {}

  async create(
    data: CreateRoundPlayedCardDTO
  ): Promise<Omit<RoundPlayedCard, 'player' | 'whiteCards'>> {
    this.assertReferencesExist(data);
    this.assertFirstPlay(data);
    const now = new Date();
    const row: PlayRow = {
      id: `played-${this.nextId++}`,
      roundId: data.roundId,
      playerId: data.playerId,
      whiteCardIds: [...data.whiteCardIds],
      createdAt: now,
      updatedAt: now
    };
    this.tables.plays.push(row);
    return { id: row.id, roundId: row.roundId, createdAt: now, updatedAt: now };
  }

  async findByRoomCodeAndRoundNumber(
    roomCode: string,
    roundNumber: number
  ): Promise<RoundPlayedCard[]> {
    const round = this.findRound(roomCode, roundNumber);
    if (!round) return [];

    return this.tables.plays
      .filter(play => play.roundId === round.id)
      .map(play => this.toPlayedCard(play));
  }

  private findRound(roomCode: string, roundNumber: number): Round | undefined {
    return [...this.tables.rounds.values()].find(
      round => round.roomCode === roomCode && round.roundNumber === roundNumber
    );
  }

  private assertReferencesExist(data: CreateRoundPlayedCardDTO): void {
    const missing = [
      this.tables.rounds.has(data.roundId) ? null : `Round "${data.roundId}"`,
      this.tables.users.has(data.playerId) ? null : `User "${data.playerId}"`,
      ...data.whiteCardIds.map(id =>
        this.findWhiteCard(id) ? null : `White Card "${id}"`
      )
    ].filter(Boolean);
    if (missing.length > 0) {
      const absent = missing.join(', ');
      throw new Error(
        `FK violation writing round_played_cards: no ${absent} (expected existing rows)`
      );
    }
  }

  private assertFirstPlay(data: CreateRoundPlayedCardDTO): void {
    const played = this.tables.plays.some(
      play => play.roundId === data.roundId && play.playerId === data.playerId
    );
    const repeatsCard =
      new Set(data.whiteCardIds).size !== data.whiteCardIds.length;
    if (played || repeatsCard) {
      const { playerId, roundId, whiteCardIds } = data;
      throw new Error(
        `Unique violation on round_played_cards: Player "${playerId}" in Round "${roundId}" with cards [${whiteCardIds}] (expected one play per Player, each card once)`
      );
    }
  }

  private findWhiteCard(id: string): WhiteCard | undefined {
    return this.tables.whiteCards.find(card => card.id === id);
  }

  private toPlayedCard(play: PlayRow): RoundPlayedCard {
    const profile = this.tables.users.get(play.playerId);
    return cloneRow({
      id: play.id,
      roundId: play.roundId,
      player: profile ?? {
        id: play.playerId,
        username: play.playerId,
        avatarUrl: null
      },
      whiteCards: play.whiteCardIds.flatMap(id => this.findWhiteCard(id) ?? []),
      createdAt: play.createdAt,
      updatedAt: play.updatedAt
    });
  }
}
