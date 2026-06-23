import type { CardPack } from './base-pack';

// Persistence seam for seeding a Card Pack. Each upsert applies
// on-conflict-do-nothing semantics so re-running the seed never grows the
// tables — that idempotency lives in the store impl (drizzle for prod, an
// in-memory map in specs). See issue #5.
export interface CardPackSeedStore {
  upsertPack(pack: { id: string; name: string; slug: string }): Promise<void>;
  upsertWhiteCards(
    cards: { id: string; text: string; packId: string }[]
  ): Promise<void>;
  upsertBlackCards(
    cards: { id: string; text: string; pick: number; packId: string }[]
  ): Promise<void>;
}

// Idempotent seed of one Card Pack that PRESERVES the in-memory card ids, so
// card text and any references to those ids stay stable across runs. The base
// pack ships a handful of duplicate ids (same id, differing text); those
// collapse first-wins here before reaching the store, which would otherwise
// hit a primary-key conflict. See issue #5.
export async function seedCardPack(
  store: CardPackSeedStore,
  pack: CardPack
): Promise<void> {
  await store.upsertPack({ id: pack.id, name: pack.name, slug: pack.id });

  await store.upsertWhiteCards(
    dedupeById(
      pack.cards.white.map(card => ({
        id: card.id,
        text: card.text,
        packId: pack.id
      }))
    )
  );

  await store.upsertBlackCards(
    dedupeById(
      pack.cards.black.map(card => ({
        id: card.id,
        text: card.text,
        pick: card.pick,
        packId: pack.id
      }))
    )
  );
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}
