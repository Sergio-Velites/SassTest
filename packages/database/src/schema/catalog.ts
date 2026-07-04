import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, softDelete, timestamps } from './helpers.js';
import { organizations, users } from './identity.js';

export const workflowTemplates = pgTable(
  'workflow_templates',
  {
    id: id(),
    /** Creator organization (templates are tenant-owned until published). */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull(),
    status: text('status').notNull().default('draft'),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('workflow_templates_org_status_idx').on(t.organizationId, t.status),
    index('workflow_templates_catalog_idx').on(t.status, t.category),
    check(
      'workflow_templates_category_check',
      sql`${t.category} IN ('finance', 'hr', 'sales', 'support', 'ops', 'other')`,
    ),
    check(
      'workflow_templates_status_check',
      sql`${t.status} IN ('draft', 'private', 'published', 'deprecated')`,
    ),
  ],
);

export const workflowTemplateVersions = pgTable(
  'workflow_template_versions',
  {
    id: id(),
    workflowTemplateId: uuid('workflow_template_id')
      .notNull()
      .references(() => workflowTemplates.id),
    /** Semver string. Immutable once published_at is set. */
    version: text('version').notNull(),
    definition: jsonb('definition').notNull(),
    changelog: text('changelog'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex('workflow_template_versions_unique').on(t.workflowTemplateId, t.version)],
);

export const marketplaceListings = pgTable(
  'marketplace_listings',
  {
    id: id(),
    workflowTemplateId: uuid('workflow_template_id')
      .notNull()
      .references(() => workflowTemplates.id),
    priceCents: integer('price_cents').notNull().default(0),
    currency: text('currency').notNull().default('EUR'),
    billingType: text('billing_type').notNull().default('one_time'),
    verified: boolean('verified').notNull().default(false),
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
    ratingCount: integer('rating_count').notNull().default(0),
    status: text('status').notNull().default('inactive'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('marketplace_listings_template_unique').on(t.workflowTemplateId),
    check(
      'marketplace_listings_billing_type_check',
      sql`${t.billingType} IN ('one_time', 'subscription')`,
    ),
    check(
      'marketplace_listings_status_check',
      sql`${t.status} IN ('inactive', 'active', 'suspended')`,
    ),
    check('marketplace_listings_price_check', sql`${t.priceCents} >= 0`),
  ],
);
