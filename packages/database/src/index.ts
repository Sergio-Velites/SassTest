/**
 * @flowhub/database — Drizzle ORM schema, client and migrations.
 *
 * Implemented in Cycle 4. The full data model (23 tables) is specified in
 * docs/architecture/DATA_MODEL.md — implement from that spec.
 * Until then this package only exports the tenancy convention constant.
 */

/**
 * Convention: every tenant-owned table has an `organization_id` column and
 * every query MUST filter by it. See docs/security/SECURITY_MODEL.md.
 */
export const TENANT_COLUMN = 'organization_id' as const;
