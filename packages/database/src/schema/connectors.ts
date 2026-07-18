import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { id, softDelete, timestamps } from './helpers.js';
import { organizations, users } from './identity.js';

export const connectorAccounts = pgTable(
  'connector_accounts',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** e.g. 'slack-mock', 'gmail-mock'. */
    connectorSlug: text('connector_slug').notNull(),
    /** User-facing label ("Slack de soporte"). */
    name: text('name').notNull(),
    authType: text('auth_type').notNull(),
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('connector_accounts_org_slug_idx').on(t.organizationId, t.connectorSlug),
    check(
      'connector_accounts_auth_type_check',
      sql`${t.authType} IN ('none', 'api_key', 'oauth2')`,
    ),
    check('connector_accounts_status_check', sql`${t.status} IN ('active', 'revoked', 'error')`),
  ],
);

/**
 * Metadata ONLY — secrets themselves live in the secrets backend
 * (encrypted table locally, GCP Secret Manager in cloud) and are addressed
 * by secret_ref. See SECURITY_MODEL.md §5.
 */
export const connectorSecretsMetadata = pgTable(
  'connector_secrets_metadata',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    connectorAccountId: uuid('connector_account_id')
      .notNull()
      .references(() => connectorAccounts.id),
    secretRef: text('secret_ref').notNull(),
    kind: text('kind').notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('connector_secrets_metadata_unique').on(t.connectorAccountId, t.kind),
    check('connector_secrets_metadata_kind_check', sql`${t.kind} IN ('api_key', 'oauth_tokens')`),
  ],
);

/**
 * Local secrets backend: AES-256-GCM ciphertext rows addressed by
 * connector_secrets_metadata.secret_ref = 'local:<id>'. In GCP the ref
 * points at Secret Manager instead (SECURITY_MODEL.md §5).
 */
export const connectorSecrets = pgTable('connector_secrets', {
  id: id(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  ciphertext: text('ciphertext').notNull(),
  ...timestamps,
});
