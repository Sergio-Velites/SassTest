import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, id, softDelete, timestamps } from './helpers.js';

export const users = pgTable(
  'users',
  {
    id: id(),
    email: citext('email').notNull(),
    /** argon2id hash; NULL once SSO providers exist. */
    passwordHash: text('password_hash'),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    check('users_status_check', sql`${t.status} IN ('active', 'suspended')`),
  ],
);

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: text('name').notNull(),
    slug: citext('slug').notNull(),
    plan: text('plan').notNull().default('free'),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('organizations_slug_unique').on(t.slug),
    check(
      'organizations_plan_check',
      sql`${t.plan} IN ('free', 'starter', 'pro', 'business', 'enterprise')`,
    ),
  ],
);

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('organization_members_org_user_unique').on(t.organizationId, t.userId),
    index('organization_members_user_idx').on(t.userId),
    check(
      'organization_members_role_check',
      sql`${t.role} IN ('owner', 'admin', 'member', 'viewer')`,
    ),
  ],
);

/**
 * Fine-grained permission catalog (Business/Enterprise custom roles).
 * MVP enforcement uses organization_members.role; these tables exist so the
 * model does not need migrating later (DATA_MODEL.md).
 */
export const roles = pgTable(
  'roles',
  {
    id: id(),
    /** NULL = system role (owner/admin/member/viewer, seeded). */
    organizationId: uuid('organization_id').references(() => organizations.id),
    name: text('name').notNull(),
    description: text('description'),
    ...timestamps,
  },
  (t) => [uniqueIndex('roles_org_name_unique').on(t.organizationId, t.name)],
);

export const permissions = pgTable('permissions', {
  /** e.g. 'workflows:install', 'approvals:resolve' */
  key: text('key').primaryKey(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    email: citext('email').notNull(),
    role: text('role').notNull(),
    /** Clear token goes out by email; only its hash is stored. */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('invitations_token_hash_unique').on(t.tokenHash),
    index('invitations_org_email_idx').on(t.organizationId, t.email),
    check('invitations_role_check', sql`${t.role} IN ('owner', 'admin', 'member', 'viewer')`),
  ],
);

/**
 * Server-side sessions (SECURITY_MODEL.md §2). The cookie carries an opaque
 * high-entropy token; only its sha256 hash is stored. Revocation = revoked_at.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    /** Tenant the session currently operates in; validated against membership. */
    activeOrganizationId: uuid('active_organization_id').references(() => organizations.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);
