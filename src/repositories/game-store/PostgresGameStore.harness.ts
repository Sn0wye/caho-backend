import type { db } from '@/db';
import { blackCards, cardPacks, users, whiteCards } from '@/db/schema';
import type { PublicUser } from '@/schemas';
import { sql } from 'drizzle-orm';
import type { CardPool } from './InMemoryGameStore';
import { PostgresGameStoreFactory } from './PostgresGameStore';
import {
  CONTRACT_POOL,
  type GameStoreHarness,
  type UserRegistry
} from './gameStore.fixtures';

// Opt-in (RUN_DB_MIGRATIONS=true) contract harness over the docker-compose.test
// database. Every open() truncates the game tables so cases stay independent
// and repeatable. Never point this at a database whose data you want to keep.

type Database = typeof db;

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

async function resetGameTables(database: Database): Promise<void> {
  const tables = GAME_TABLES.join(', ');
  await database.execute(sql.raw(`TRUNCATE TABLE ${tables} CASCADE`));
}

async function insertCardPool(
  database: Database,
  pool: CardPool
): Promise<void> {
  const cards = [...pool.whiteCards, ...pool.blackCards];
  const packIds = [...new Set(cards.map(card => card.packId))];
  if (packIds.length === 0) return;

  await database
    .insert(cardPacks)
    .values(packIds.map(id => ({ id, name: id, slug: id })));
  if (pool.whiteCards.length > 0)
    await database.insert(whiteCards).values(pool.whiteCards);
  if (pool.blackCards.length > 0)
    await database.insert(blackCards).values(pool.blackCards);
}

/**
 * users rows behind the Users a contract seed references (FKs).
 *
 * @example
 * await new PostgresUserRegistry(db).registerUser({ id: 'player-a', username: 'Ana', avatarUrl: null });
 */
export class PostgresUserRegistry implements UserRegistry {
  constructor(private readonly database: Database) {}

  async ensureUser(id: string): Promise<void> {
    await this.database
      .insert(users)
      .values({ id, username: id, password: '' })
      .onConflictDoNothing({ target: users.id });
  }

  async registerUser(user: PublicUser): Promise<void> {
    await this.database
      .insert(users)
      .values({ ...user, password: '' })
      .onConflictDoUpdate({
        target: users.id,
        set: { username: user.username, avatarUrl: user.avatarUrl }
      });
  }
}

/**
 * The contract harness over `database`. Store reads/writes go through the
 * production repositories, which use the app's pool; pass that pool's `db`.
 *
 * @example
 * describeGameStoreContract(createPostgresGameStoreHarness(db));
 */
export function createPostgresGameStoreHarness(
  database: Database
): GameStoreHarness {
  return {
    name: 'Postgres',
    users: new PostgresUserRegistry(database),
    async open() {
      await resetGameTables(database);
      await insertCardPool(database, CONTRACT_POOL);
      return PostgresGameStoreFactory();
    }
  };
}
