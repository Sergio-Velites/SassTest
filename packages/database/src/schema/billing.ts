import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from './helpers.js';
import { organizations } from './identity.js';

/** Global plan catalog (seeded). No real charging in the MVP. */
export const plans = pgTable(
  'plans',
  {
    slug: text('slug').primaryKey(),
    name: text('name').notNull(),
    priceCents: integer('price_cents').notNull().default(0),
    currency: text('currency').notNull().default('EUR'),
    /** { maxUsers, maxInstalledWorkflows, maxExecutionsPerMonth, aiBudgetUsd } */
    limits: jsonb('limits').notNull().default({}),
    ...timestamps,
  },
  (t) => [
    check(
      'plans_slug_check',
      sql`${t.slug} IN ('free', 'starter', 'pro', 'business', 'enterprise')`,
    ),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    planSlug: text('plan_slug')
      .notNull()
      .references(() => plans.slug),
    status: text('status').notNull().default('active'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    /** Future Stripe subscription id. */
    externalRef: text('external_ref'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('subscriptions_org_unique').on(t.organizationId),
    check(
      'subscriptions_status_check',
      sql`${t.status} IN ('active', 'trialing', 'past_due', 'cancelled')`,
    ),
  ],
);

/** Placeholder until real billing lands (post-MVP). */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    amountCents: integer('amount_cents').notNull().default(0),
    currency: text('currency').notNull().default('EUR'),
    status: text('status').notNull().default('draft'),
    lineItems: jsonb('line_items').notNull().default([]),
    ...timestamps,
  },
  (t) => [
    index('invoices_org_idx').on(t.organizationId, t.periodStart),
    check('invoices_status_check', sql`${t.status} IN ('draft', 'issued', 'paid', 'void')`),
  ],
);

/** Placeholder for marketplace creator payouts (post-MVP). */
export const marketplacePayouts = pgTable(
  'marketplace_payouts',
  {
    id: id(),
    /** Creator organization receiving the payout. */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    grossCents: integer('gross_cents').notNull().default(0),
    commissionCents: integer('commission_cents').notNull().default(0),
    netCents: integer('net_cents').notNull().default(0),
    currency: text('currency').notNull().default('EUR'),
    status: text('status').notNull().default('pending'),
    ...timestamps,
  },
  (t) => [
    index('marketplace_payouts_org_idx').on(t.organizationId, t.periodStart),
    check('marketplace_payouts_status_check', sql`${t.status} IN ('pending', 'paid')`),
  ],
);
