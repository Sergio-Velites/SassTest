/**
 * @flowhub/database — Drizzle ORM schema, client and migrations.
 *
 * The data model is specified in docs/architecture/DATA_MODEL.md — keep both
 * in sync. Migrations live in ./migrations and are immutable once committed.
 *
 * Tenancy convention: every tenant-owned table has an `organization_id`
 * column and every query MUST filter by it (SECURITY_MODEL.md §4).
 */

export const TENANT_COLUMN = 'organization_id' as const;

export * from './client.js';
export * as schema from './schema/index.js';
