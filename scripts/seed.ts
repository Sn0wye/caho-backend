import { basePack } from '../src/cards/base-pack';
import { drizzleSeedStore } from '../src/cards/drizzleSeedStore';
import { seedCardPack } from '../src/cards/seedCardPack';

seedCardPack(drizzleSeedStore, basePack)
  .then(() => {
    console.log(`Seeded card pack "${basePack.name}" (${basePack.id})`);
    process.exit(0);
  })
  .catch(error => {
    console.error('Failed to seed card pack:', error);
    process.exit(1);
  });
