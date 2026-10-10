import { db } from '@/db';
import { blackCards, cardPacks, whiteCards } from '@/db/schema';
import type { CardPackSeedStore } from './seedCardPack';

// Drizzle adapter for the seed store. `onConflictDoNothing` keys on the primary
// key (the card id), which is what makes re-running the seed idempotent and lets
// us preserve the in-memory ids. Seeding logic + id de-dup lives in
// seedCardPack; this file only wires it to Postgres. See issue #5.
export const drizzleSeedStore: CardPackSeedStore = {
  async upsertPack(pack) {
    await db.insert(cardPacks).values(pack).onConflictDoNothing();
  },
  async upsertWhiteCards(cards) {
    if (cards.length === 0) return;
    await db.insert(whiteCards).values(cards).onConflictDoNothing();
  },
  async upsertBlackCards(cards) {
    if (cards.length === 0) return;
    await db.insert(blackCards).values(cards).onConflictDoNothing();
  }
};
