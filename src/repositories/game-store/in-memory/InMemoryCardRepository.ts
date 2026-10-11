import type { BlackCard, ICardRepository } from '@/repositories/cards';
import type { WhiteCard } from '@/schemas';
import type { InMemoryGameTables } from './InMemoryGameTables';

// Deterministic, exclusion-respecting pool so draw assertions are stable. The
// production repo selects at random in SQL; here we hand cards out in order,
// honouring excludeIds exactly as the SQL NOT IN clause would.
export class InMemoryCardRepository implements ICardRepository {
  constructor(private readonly tables: InMemoryGameTables) {}

  async drawWhiteCards(input: { count: number; excludeIds: string[] }): Promise<
    WhiteCard[]
  > {
    return this.tables.whiteCards
      .filter(card => !input.excludeIds.includes(card.id))
      .slice(0, input.count)
      .map(card => ({ ...card }));
  }

  async drawBlackCard(input: { excludeIds: string[] }): Promise<
    BlackCard | undefined
  > {
    const card = this.tables.blackCards.find(
      card => !input.excludeIds.includes(card.id)
    );
    return card ? { ...card } : undefined;
  }

  async findWhiteCardById(id: string): Promise<WhiteCard | undefined> {
    const card = this.tables.whiteCards.find(card => card.id === id);
    return card ? { ...card } : undefined;
  }

  async findBlackCardById(id: string): Promise<BlackCard | undefined> {
    const card = this.tables.blackCards.find(card => card.id === id);
    return card ? { ...card } : undefined;
  }
}
