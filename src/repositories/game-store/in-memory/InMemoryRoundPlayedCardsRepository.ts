import type { CreateRoundPlayedCardDTO } from '@/dto/CreateRoundPlayedCard';
import type { IRoundPlayedCardsRepository } from '@/repositories/round-played-cards';
import type { Round, RoundPlayedCard, WhiteCard } from '@/schemas';
import type { InMemoryGameTables, PlayedCardsRow } from './InMemoryGameTables';

// round_played_cards + its ordered white-card pivot. Writes enforce the same
// keys as Postgres (one answer per Round and Player, real Round/User/White
// Cards) and, like its transaction, store nothing when they fail. Reads join
// the Player's public profile and the cards in submitted order.
export class InMemoryRoundPlayedCardsRepository
  implements IRoundPlayedCardsRepository
{
  private nextId = 1;

  constructor(private readonly tables: InMemoryGameTables) {}

  /**
   * Record a Player's Played Cards for a Round, all or nothing.
   *
   * @example
   * await store.playedCards.create({ roundId: 'round-1', playerId: 'player-a', whiteCardIds: ['w3', 'w1'] });
   */
  async create(
    answer: CreateRoundPlayedCardDTO
  ): Promise<Omit<RoundPlayedCard, 'player' | 'whiteCards'>> {
    this.assertReferencesExist(answer);
    this.assertFirstAnswer(answer);
    const now = new Date();
    const row: PlayedCardsRow = {
      id: `played-${this.nextId++}`,
      roundId: answer.roundId,
      playerId: answer.playerId,
      whiteCardIds: [...answer.whiteCardIds],
      createdAt: now,
      updatedAt: now
    };
    this.tables.playedCards.push(row);
    return { id: row.id, roundId: row.roundId, createdAt: now, updatedAt: now };
  }

  /**
   * Record a play only if `assertRoundOpen` accepts the Round as stored now.
   * No await separates the check from the write, standing in for the row lock.
   *
   * @example
   * await store.playedCards.createInLockedRound(answer, round => assertPlayingPhase(round));
   */
  async createInLockedRound(
    answer: CreateRoundPlayedCardDTO,
    assertRoundOpen: (lockedRound: Round) => void
  ): Promise<Omit<RoundPlayedCard, 'player' | 'whiteCards'>> {
    const round = this.tables.rounds.get(answer.roundId);
    if (!round) {
      throw new Error(
        `Round "${answer.roundId}" not found while recording a play (expected an existing Round)`
      );
    }
    assertRoundOpen(structuredClone(round));
    return await this.create(answer);
  }

  async findByRoomCodeAndRoundNumber(
    roomCode: string,
    roundNumber: number
  ): Promise<RoundPlayedCard[]> {
    const round = this.findRound(roomCode, roundNumber);
    if (!round) return [];

    return this.tables.playedCards
      .filter(row => row.roundId === round.id)
      .map(row => this.toPlayedCards(row));
  }

  private findRound(roomCode: string, roundNumber: number): Round | undefined {
    return [...this.tables.rounds.values()].find(
      round => round.roomCode === roomCode && round.roundNumber === roundNumber
    );
  }

  private assertReferencesExist(answer: CreateRoundPlayedCardDTO): void {
    const { roundId, playerId, whiteCardIds } = answer;
    const missing = [
      this.tables.rounds.has(roundId) ? null : `Round "${roundId}"`,
      this.tables.users.has(playerId) ? null : `User "${playerId}"`,
      ...whiteCardIds.map(id =>
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

  private assertFirstAnswer(answer: CreateRoundPlayedCardDTO): void {
    const { playerId, roundId, whiteCardIds } = answer;
    const answered = this.tables.playedCards.some(
      row => row.roundId === roundId && row.playerId === playerId
    );
    const repeatsCard = new Set(whiteCardIds).size !== whiteCardIds.length;
    if (answered || repeatsCard) {
      throw new Error(
        `Unique violation on round_played_cards: Player "${playerId}" in Round "${roundId}" with cards [${whiteCardIds}] (expected one answer per Player, each card once)`
      );
    }
  }

  private findWhiteCard(id: string): WhiteCard | undefined {
    return this.tables.whiteCards.find(card => card.id === id);
  }

  private toPlayedCards(row: PlayedCardsRow): RoundPlayedCard {
    const profile = this.tables.users.get(row.playerId);
    return structuredClone({
      id: row.id,
      roundId: row.roundId,
      player: profile ?? {
        id: row.playerId,
        username: row.playerId,
        avatarUrl: null
      },
      whiteCards: row.whiteCardIds.flatMap(id => this.findWhiteCard(id) ?? []),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    });
  }
}
