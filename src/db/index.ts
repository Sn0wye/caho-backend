import { env } from '@/env';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const client = new pg.Pool({
  connectionString: env.DATABASE_URL
});

export const db = drizzle(client, {
  schema,
  // Query serialization and stdout writes add work to every production request.
  logger: env.NODE_ENV !== 'production'
});
