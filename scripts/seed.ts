import snowyePack from '../../web/packs/snowye-pack';
import { basePack, type CardPack } from '../src/cards/base-pack';
import { db } from '../src/db';
import { blackCards, cardPacks, whiteCards } from '../src/db/schema';

async function seed(cardPacksData: CardPack[]) {
  // Insert pack
  const [insertedPack] = await db
    .insert(cardPacks)
    .values({
      name: 'Pacote Padrão',
      slug: 'base-pack'
    })
    .returning({ id: cardPacks.id });

  const newPackId = insertedPack.id;

  for (const pack of cardPacksData) {
    // Insert white cards
    if (pack.cards.white.length > 0) {
      await db.insert(whiteCards).values(
        pack.cards.white.map(card => ({
          text: card.text,
          packId: newPackId
        }))
      );
    }

    // Insert black cards
    if (pack.cards.black.length > 0) {
      await db.insert(blackCards).values(
        pack.cards.black.map(card => ({
          text: card.text,
          pick: card.pick,
          packId: newPackId
        }))
      );
    }
  }
}

// Example usage
// import your JSON or files here
const packs: CardPack[] = [basePack, snowyePack];
seed(packs);
