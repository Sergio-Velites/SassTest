import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  /** Closes the underlying pool. Call on graceful shutdown. */
  close(): Promise<void>;
}

/**
 * Creates the database client. One pool per process; pass the handle down
 * explicitly (no module-level singletons — keeps tests isolated).
 */
export function createDb(databaseUrl: string, options?: { maxConnections?: number }): DbHandle {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options?.maxConnections ?? 10,
  });
  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}
