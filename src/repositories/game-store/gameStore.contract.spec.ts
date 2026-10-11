import { db, postgresPool } from '@/db';
import { afterAll, describe } from 'vitest';
import { InMemoryGameStore } from './InMemoryGameStore';
import { createPostgresGameStoreHarness } from './PostgresGameStore.harness';
import { describeGameStoreContract } from './gameStore.contract';
import { CONTRACT_POOL } from './gameStore.fixtures';

// One contract, two adapters (issue #24). The in-memory run is always on; the
// Postgres run needs the docker-compose.test database and is opt-in through the
// same switch that migrates it (vitest.setup.ts):
//   docker compose -f docker-compose.test.yml up -d --wait
//   RUN_DB_MIGRATIONS=true pnpm test

describeGameStoreContract({
  name: 'in-memory',
  async open() {
    return new InMemoryGameStore(CONTRACT_POOL);
  }
});

describe.skipIf(process.env.RUN_DB_MIGRATIONS !== 'true')('Postgres', () => {
  afterAll(async () => {
    await postgresPool.end();
  });

  describeGameStoreContract(createPostgresGameStoreHarness(db));
});
