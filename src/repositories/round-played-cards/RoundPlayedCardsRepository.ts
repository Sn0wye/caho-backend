import { db } from '@/db';
import { roundPlayedCardWhiteCards, roundPlayedCards } from '@/db/schema';
import type { CreateRoundPlayedCardDTO } from '@/dto/CreateRoundPlayedCard';
import type { RoundPlayedCard } from '@/schemas';
import { createId } from '@paralleldrive/cuid2';
import { asc } from 'drizzle-orm';
import type { IRoundPlayedCardsRepository } from './IRoundPlayedCardsRepository';

export class RoundPlayedCardsRepository implements IRoundPlayedCardsRepository {
  private readonly db = db;

  // One transaction for the answer and its cards: a failed card insert used to
  // leave the answer row behind, so the Player's corrected retry hit the
  // one-answer-per-Round index and was locked out. Found by the game-store
  // contract (issue #24).
  public async create(
    data: CreateRoundPlayedCardDTO
  ): Promise<Omit<RoundPlayedCard, 'player' | 'whiteCards'>> {
    const inserted = await this.db.transaction(async tx => {
      const [answer] = await tx
        .insert(roundPlayedCards)
        .values({
          id: createId(),
          roundId: data.roundId,
          playerId: data.playerId
        })
        .returning();

      if (!answer) throw new Error('Failed to create round played card');

      await tx.insert(roundPlayedCardWhiteCards).values(
        data.whiteCardIds.map((whiteCardId, position) => ({
          roundPlayedCardId: answer.id,
          whiteCardId,
          position
        }))
      );
      return answer;
    });

    return {
      id: inserted.id,
      roundId: inserted.roundId,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt
    };
  }

  public async findByRoomCodeAndRoundNumber(
    roomCode: string,
    roundNumber: number
  ): Promise<RoundPlayedCard[]> {
    const round = await this.db.query.rounds.findFirst({
      where: (rounds, { and, eq }) =>
        and(eq(rounds.roomCode, roomCode), eq(rounds.roundNumber, roundNumber))
    });

    if (!round) return [];

    const playedCards = await this.db.query.roundPlayedCards.findMany({
      where: (roundPlayedCards, { eq }) =>
        eq(roundPlayedCards.roundId, round.id),
      with: {
        // Only the public fields: these payloads are broadcast to the Room.
        player: { columns: { id: true, username: true, avatarUrl: true } },
        whiteCards: {
          orderBy: pivot => [asc(pivot.position)],
          with: {
            whiteCard: true
          }
        }
      }
    });

    return playedCards.map(card => ({
      id: card.id,
      roundId: card.roundId,
      player: card.player,
      whiteCards: card.whiteCards.map(pivot => ({
        id: pivot.whiteCard.id,
        text: pivot.whiteCard.text,
        packId: pivot.whiteCard.packId
      })),
      createdAt: card.createdAt,
      updatedAt: card.updatedAt
    }));
  }
}
