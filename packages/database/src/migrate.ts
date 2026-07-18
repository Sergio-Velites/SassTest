/**
 * Production migration runner. Uses drizzle-orm's programmatic migrator so
 * the runtime image needs no drizzle-kit (a dev dependency). Cloud Run runs
 * this as a job before each deploy; locally: pnpm --filter @flowhub/database migrate:prod
 *
 * Idempotent: drizzle records applied migrations and skips them.
 */
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb } from './client.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
const handle = createDb(databaseUrl, { maxConnections: 1 });

try {
  await migrate(handle.db, { migrationsFolder });
  // eslint-disable-next-line no-console -- CLI feedback for the deploy pipeline
  console.log('migrations applied successfully');
} catch (error) {
  console.error('migration failed:', (error as Error).message);
  process.exitCode = 1;
} finally {
  await handle.close();
}
