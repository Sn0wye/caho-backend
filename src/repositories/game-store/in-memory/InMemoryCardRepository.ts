import type { BlackCard, ICardRepository } from '@/repositories/cards';
import type { WhiteCard } from '@/schemas';
import type { InMemoryGameTables } from './InMemoryGameTables';

// Deterministic, exclusion-respecting pool so draw assertions are stable. The
// production repo selects at random in SQL; here we hand cards out in order,
// honouring excludeIds exactly as the SQL NOT IN clause would.
export class InMemoryCardRepository implements ICardRepository {
  constructor(private readonly tables: InMemoryGameTables) {}

  /**
   * The first `count` White Cards not in `excludeIds`.
   *
   * @example
   * const hand = await store.cards.drawWhiteCards({ count: 10, excludeIds: room.pickedWhiteCards });
   */
  async drawWhiteCards(input: { count: number; excludeIds: string[] }): Promise<
    WhiteCard[]
  > {
    return this.tables.whiteCards
      .filter(card => !input.excludeIds.includes(card.id))
      .slice(0, input.count)
      .map(card => ({ ...card }));
  }

  /**
   * The first Black Card not in `excludeIds`, or undefined.
   *
   * @example
   * const card = await store.cards.drawBlackCard({ excludeIds: room.pickedBlackCards });
   */
  async drawBlackCard(input: { excludeIds: string[] }): Promise<
    BlackCard | undefined
  > {
    const card = this.tables.blackCards.find(
      card => !input.excludeIds.includes(card.id)
    );
    return card ? { ...card } : undefined;
  }

  /**
   * A White Card by id, or undefined.
   *
   * @example
   * const card = await store.cards.findWhiteCardById('w1');
   */
  async findWhiteCardById(id: string): Promise<WhiteCard | undefined> {
    const card = this.tables.whiteCards.find(card => card.id === id);
    return card ? { ...card } : undefined;
  }

  /**
   * A Black Card by id, or undefined.
   *
   * @example
   * const card = await store.cards.findBlackCardById('black-1');
   */
  async findBlackCardById(id: string): Promise<BlackCard | undefined> {
    const card = this.tables.blackCards.find(card => card.id === id);
    return card ? { ...card } : undefined;
  }
}
