import path from 'node:path';
import { basePack } from '@/cards/base-pack';
import { drizzleSeedStore } from '@/cards/drizzleSeedStore';
import { seedCardPack } from '@/cards/seedCardPack';
import { db } from '@/db';
import { logger } from '@/lib/logger';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

// One-shot database setup for deploys: apply pending migrations, then seed the
// base card pack. Both steps are idempotent, so it is safe on every deploy.
// Without it a fresh container had an empty card pool and no game could start.
// Runs with prod deps only (drizzle-orm's migrator, not drizzle-kit).
// Usage: `node dist/migrate.js` (image) or `pnpm db:setup` (local).
async function setupDatabase(): Promise<void> {
  // Same bookkeeping table as drizzle.config.ts, so drizzle-kit and this
  // runner agree on which migrations already ran.
  await migrate(db, {
    migrationsFolder: path.resolve(process.env.MIGRATIONS_DIR ?? 'migrations'),
    migrationsTable: 'migrations',
    migrationsSchema: 'public'
  });
  logger.info({ step: 'migrate' }, 'migrations applied');

  await seedCardPack(drizzleSeedStore, basePack);
  logger.info({ step: 'seed', pack: basePack.id }, 'card pack seeded');
}

setupDatabase()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error({ error }, 'database setup failed');
    process.exit(1);
  });
