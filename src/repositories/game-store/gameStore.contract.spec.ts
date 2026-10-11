import { postgresPool } from '@/db';
import { afterAll, describe } from 'vitest';
import { InMemoryGameStore } from './InMemoryGameStore';
import { postgresGameStoreHarness } from './PostgresGameStore.harness';
import { describeGameStoreContract } from './gameStore.contract';
import { IN_MEMORY_USERS } from './gameStore.fixtures';

// One contract, two adapters (issue #24). The in-memory run is always on; the
// Postgres run needs the docker-compose.test database and is opt-in through the
// same switch that migrates it (vitest.setup.ts):
//   docker compose -f docker-compose.test.yml up -d --wait
//   RUN_DB_MIGRATIONS=true pnpm test

describeGameStoreContract({
  ...IN_MEMORY_USERS,
  name: 'in-memory',
  async open(pool) {
    return new InMemoryGameStore(pool);
  }
});

describe.skipIf(process.env.RUN_DB_MIGRATIONS !== 'true')('Postgres', () => {
  afterAll(async () => {
    await postgresPool.end();
  });

  describeGameStoreContract(postgresGameStoreHarness);
});
