import type { BlackCard, ICardRepository } from '@/repositories/cards';
import type { WhiteCard } from '@/schemas';

// Deterministic, exclusion-respecting pool so draw assertions are stable. The
// production repo selects at random in SQL; here we hand cards out in order,
// honouring excludeIds exactly as the SQL NOT IN clause would.
export class FakeCardRepository implements ICardRepository {
  constructor(
    private readonly whiteCards: WhiteCard[],
    private readonly blackCards: BlackCard[]
  ) {}

  async drawWhiteCards(input: { count: number; excludeIds: string[] }) {
    return this.whiteCards
      .filter(card => !input.excludeIds.includes(card.id))
      .slice(0, input.count);
  }

  async drawBlackCard(input: { excludeIds: string[] }) {
    return this.blackCards.find(card => !input.excludeIds.includes(card.id));
  }

  async findWhiteCardById(id: string) {
    return this.whiteCards.find(card => card.id === id);
  }

  async findBlackCardById(id: string) {
    return this.blackCards.find(card => card.id === id);
  }
}
