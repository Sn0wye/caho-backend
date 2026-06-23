import { describe, expect, it } from 'vitest';
import type { CardPack } from './base-pack';
import { type CardPackSeedStore, seedCardPack } from './seedCardPack';

// Models the store's on-conflict-do-nothing semantics in memory so the seeding
// logic can be exercised without a live Postgres. A real-DB integration test of
// the drizzle store is tracked for later. See issue #5.
class FakeCardPackSeedStore implements CardPackSeedStore {
  readonly packs = new Map<string, { id: string; name: string; slug: string }>();
  readonly whiteCards = new Map<string, { id: string; text: string; packId: string }>();
  readonly blackCards = new Map<
    string,
    { id: string; text: string; pick: number; packId: string }
  >();

  async upsertPack(pack: { id: string; name: string; slug: string }) {
    if (!this.packs.has(pack.id)) this.packs.set(pack.id, pack);
  }

  async upsertWhiteCards(cards: { id: string; text: string; packId: string }[]) {
    for (const card of cards) {
      if (!this.whiteCards.has(card.id)) this.whiteCards.set(card.id, card);
    }
  }

  async upsertBlackCards(
    cards: { id: string; text: string; pick: number; packId: string }[]
  ) {
    for (const card of cards) {
      if (!this.blackCards.has(card.id)) this.blackCards.set(card.id, card);
    }
  }
}

function makePack(overrides: Partial<CardPack> = {}): CardPack {
  return {
    id: 'base-pack',
    name: 'Pacote padrão',
    official: true,
    cards: {
      white: [
        { id: 'white-1', text: 'first white', packId: 'base-pack' },
        { id: 'white-2', text: 'second white', packId: 'base-pack' }
      ],
      black: [{ id: 'black-1', text: 'first black', pick: 1, packId: 'base-pack' }]
    },
    ...overrides
  };
}

describe('seedCardPack', () => {
  it('seeds the pack and its cards preserving the in-memory ids', async () => {
    const store = new FakeCardPackSeedStore();

    await seedCardPack(store, makePack());

    expect(store.packs.get('base-pack')).toMatchObject({ id: 'base-pack' });
    expect([...store.whiteCards.keys()]).toEqual(['white-1', 'white-2']);
    expect(store.whiteCards.get('white-1')?.text).toBe('first white');
    expect(store.blackCards.get('black-1')).toMatchObject({
      id: 'black-1',
      pick: 1
    });
  });

  it('is idempotent: re-running never grows the tables', async () => {
    const store = new FakeCardPackSeedStore();
    const pack = makePack();

    await seedCardPack(store, pack);
    await seedCardPack(store, pack);

    expect(store.packs.size).toBe(1);
    expect(store.whiteCards.size).toBe(2);
    expect(store.blackCards.size).toBe(1);
  });

  it('collapses intra-pack duplicate ids to a single first-wins card', async () => {
    const store = new FakeCardPackSeedStore();
    const pack = makePack({
      cards: {
        white: [
          { id: 'dup', text: 'kept text', packId: 'base-pack' },
          { id: 'dup', text: 'dropped text', packId: 'base-pack' }
        ],
        black: []
      }
    });

    await seedCardPack(store, pack);

    expect(store.whiteCards.size).toBe(1);
    expect(store.whiteCards.get('dup')?.text).toBe('kept text');
  });
});
