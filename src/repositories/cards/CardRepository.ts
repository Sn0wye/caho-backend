import { db } from '@/db';
import { blackCards, whiteCards } from '@/db/schema';
import type { WhiteCard } from '@/schemas';
import { type Column, eq, notInArray, sql } from 'drizzle-orm';
import type { BlackCard, ICardRepository } from './ICardRepository';

// Draws cards straight from the DB pool. Random selection happens in SQL
// (`ORDER BY random()`) and already-picked ids are filtered with NOT IN, so a
// Room never repeats a card. Mirrors the old in-memory CardService draw (#5).
//
// TODO(#5): cover this drizzle adapter with a real-Postgres integration test
// (opt-in via RUN_DB_MIGRATIONS) — random draw, exclusion, and by-id lookup.
export class CardRepository implements ICardRepository {
  private readonly db = db;

  public async drawWhiteCards(input: {
    count: number;
    excludeIds: string[];
  }): Promise<WhiteCard[]> {
    return this.db
      .select({
        id: whiteCards.id,
        text: whiteCards.text,
        packId: whiteCards.packId
      })
      .from(whiteCards)
      .where(this.excluding(whiteCards.id, input.excludeIds))
      .orderBy(sql`random()`)
      .limit(input.count);
  }

  public async drawBlackCard(input: {
    excludeIds: string[];
  }): Promise<BlackCard | undefined> {
    const [card] = await this.db
      .select({
        id: blackCards.id,
        text: blackCards.text,
        pick: blackCards.pick,
        packId: blackCards.packId
      })
      .from(blackCards)
      .where(this.excluding(blackCards.id, input.excludeIds))
      .orderBy(sql`random()`)
      .limit(1);
    return card;
  }

  public async findWhiteCardById(id: string): Promise<WhiteCard | undefined> {
    const [card] = await this.db
      .select({
        id: whiteCards.id,
        text: whiteCards.text,
        packId: whiteCards.packId
      })
      .from(whiteCards)
      .where(eq(whiteCards.id, id))
      .limit(1);
    return card;
  }

  public async findBlackCardById(id: string): Promise<BlackCard | undefined> {
    const [card] = await this.db
      .select({
        id: blackCards.id,
        text: blackCards.text,
        pick: blackCards.pick,
        packId: blackCards.packId
      })
      .from(blackCards)
      .where(eq(blackCards.id, id))
      .limit(1);
    return card;
  }

  // drizzle treats `undefined` as "no filter"; an empty NOT IN would match
  // nothing, so skip the clause when there is nothing to exclude.
  private excluding(column: Column, excludeIds: string[]) {
    return excludeIds.length > 0 ? notInArray(column, excludeIds) : undefined;
  }
}
