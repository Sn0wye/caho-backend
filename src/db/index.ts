import { env } from '@/env';
import { logger } from '@/lib/logger';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export const postgresPool = new pg.Pool({
  connectionString: env.DATABASE_URL
});

postgresPool.on('error', (err: Error) => {
  logger.error(
    { event: 'postgres.connection_failed', err },
    'Idle PostgreSQL connection failed'
  );
});

export const db = drizzle(postgresPool, {
  schema,
  // Query serialization and stdout writes add work to every production request.
  // SQL parameters include credentials and private Hands. Use safe OTEL spans.
  logger: false
});
