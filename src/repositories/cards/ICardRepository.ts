import type { WhiteCard } from '@/schemas';

// A drawn Black Card. The shared `@/schemas` BlackCard predates DB-backed cards
// and carries no id; draws need the id to record picks and set the current
// Black Card, so the card repository owns this fuller shape. See issue #5.
export interface BlackCard {
  id: string;
  text: string;
  pick: number;
  packId: string;
}

// Seam over the DB card pool (white_cards / black_cards). Draws select at random
// in SQL and exclude the ids a Room has already picked, so a card never repeats
// within a Room. Scope is the single base pack — per-room pack selection is out
// of scope (issue #5).
export interface ICardRepository {
  drawWhiteCards(input: {
    count: number;
    excludeIds: string[];
  }): Promise<WhiteCard[]>;
  drawBlackCard(input: { excludeIds: string[] }): Promise<BlackCard | undefined>;
  findWhiteCardById(id: string): Promise<WhiteCard | undefined>;
  findBlackCardById(id: string): Promise<BlackCard | undefined>;
}
