import { basePack } from '../src/cards/base-pack';
import {
  type CardPackSeedStore,
  seedCardPack
} from '../src/cards/seedCardPack';
import { db } from '../src/db';
import { blackCards, cardPacks, whiteCards } from '../src/db/schema';

// Drizzle adapter for the seed store. `onConflictDoNothing` keys on the primary
// key (the card id), which is what makes re-running the seed idempotent and lets
// us preserve the in-memory ids. Seeding logic + id de-dup lives in
// seedCardPack; this file only wires it to Postgres. See issue #5.
const store: CardPackSeedStore = {
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

seedCardPack(store, basePack)
  .then(() => {
    console.log(`Seeded card pack "${basePack.name}" (${basePack.id})`);
    process.exit(0);
  })
  .catch(error => {
    console.error('Failed to seed card pack:', error);
    process.exit(1);
  });
