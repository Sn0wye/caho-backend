import { execSync } from 'node:child_process';

// Only migrate when a spec actually hits the database. Pure service/unit specs
// run with named fakes and must not require a live Postgres. Integration specs
// opt in with RUN_DB_MIGRATIONS=true. See issue #1 (TDD for the core game loop).
if (process.env.RUN_DB_MIGRATIONS === 'true') {
  execSync('dotenv -e .env.test pnpm db:migrate', { stdio: 'inherit' });
}
