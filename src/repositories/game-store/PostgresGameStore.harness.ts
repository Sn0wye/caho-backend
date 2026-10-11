import { db } from '@/db';
import { blackCards, cardPacks, users, whiteCards } from '@/db/schema';
import type { PublicUser } from '@/schemas';
import { sql } from 'drizzle-orm';
import { PostgresGameStoreFactory } from './PostgresGameStore';
import type { CardPool, GameStoreHarness } from './gameStore.fixtures';

// Opt-in (RUN_DB_MIGRATIONS=true) contract harness over the docker-compose.test
// database. Every open() truncates the game tables so cases stay independent
// and repeatable. Never point this at a database whose data you want to keep.

const GAME_TABLES = [
  'round_played_card_white_cards',
  'round_played_cards',
  'rounds',
  'room_players',
  'rooms',
  'user_sessions',
  'oauth_accounts',
  'users',
  'white_cards',
  'black_cards',
  'card_packs'
];

async function resetGameTables(): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE ${GAME_TABLES.join(', ')} CASCADE`));
}

async function insertCardPool(pool: CardPool): Promise<void> {
  const cards = [...pool.whiteCards, ...pool.blackCards];
  const packIds = [...new Set(cards.map(card => card.packId))];
  if (packIds.length === 0) return;

  await db
    .insert(cardPacks)
    .values(packIds.map(id => ({ id, name: id, slug: id })));
  if (pool.whiteCards.length > 0)
    await db.insert(whiteCards).values(pool.whiteCards);
  if (pool.blackCards.length > 0)
    await db.insert(blackCards).values(pool.blackCards);
}

export const postgresGameStoreHarness: GameStoreHarness = {
  name: 'Postgres',

  async open(pool) {
    await resetGameTables();
    await insertCardPool(pool);
    return PostgresGameStoreFactory();
  },

  async ensureUser(id: string) {
    await db
      .insert(users)
      .values({ id, username: id, password: '' })
      .onConflictDoNothing({ target: users.id });
  },

  async registerUser(user: PublicUser) {
    await db
      .insert(users)
      .values({ ...user, password: '' })
      .onConflictDoUpdate({
        target: users.id,
        set: { username: user.username, avatarUrl: user.avatarUrl }
      });
  }
};
