import { sql } from 'drizzle-orm';
import {
  check,
  index,
  inet,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from './helpers.js';
import { organizations, users } from './identity.js';

/** Append-only, never deleted (SECURITY_MODEL.md §6). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** NULL = system actor. */
    actorUserId: uuid('actor_user_id').references(() => users.id),
    /** e.g. 'workflow.installed', 'approval.resolved', 'member.role_changed'. */
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    /** Redacted before insert. */
    metadata: jsonb('metadata'),
    ipAddress: inet('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_org_created_idx').on(t.organizationId, t.createdAt),
    index('audit_logs_org_action_idx').on(t.organizationId, t.action),
  ],
);

/**
 * Append-only usage stream behind the UsageEventSink interface.
 * Future BigQuery export replaces the sink, not the producers (ADR-0008).
 */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** 'execution.completed', 'ai.call', 'document.processed', ... */
    eventType: text('event_type').notNull(),
    quantity: numeric('quantity').notNull().default('1'),
    metadata: jsonb('metadata'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('usage_events_billing_idx').on(t.organizationId, t.eventType, t.occurredAt),
    check('usage_events_quantity_check', sql`${t.quantity} > 0`),
  ],
);
