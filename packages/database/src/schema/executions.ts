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
import { organizations, users } from './identity.js';
import { installedWorkflows, workflowVersions } from './workflows.js';

export const workflowExecutions = pgTable(
  'workflow_executions',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    installedWorkflowId: uuid('installed_workflow_id')
      .notNull()
      .references(() => installedWorkflows.id),
    /** Exact version the run used — history stays interpretable forever. */
    workflowVersionId: uuid('workflow_version_id')
      .notNull()
      .references(() => workflowVersions.id),
    status: text('status').notNull().default('pending'),
    triggerType: text('trigger_type').notNull(),
    /** ExecutionContextData snapshot (sanitized — never secrets). */
    context: jsonb('context').notNull().default({}),
    currentNodeId: text('current_node_id'),
    error: jsonb('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** NULL when triggered by the system (schedule/webhook). */
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('workflow_executions_org_wf_idx').on(
      t.organizationId,
      t.installedWorkflowId,
      t.createdAt,
    ),
    index('workflow_executions_org_status_idx').on(t.organizationId, t.status),
    check(
      'workflow_executions_status_check',
      sql`${t.status} IN ('pending', 'running', 'waiting', 'waiting_approval', 'succeeded', 'failed', 'cancelled')`,
    ),
    check(
      'workflow_executions_trigger_check',
      sql`${t.triggerType} IN ('manual', 'webhook', 'schedule')`,
    ),
  ],
);

export const workflowExecutionSteps = pgTable(
  'workflow_execution_steps',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workflowExecutionId: uuid('workflow_execution_id')
      .notNull()
      .references(() => workflowExecutions.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    nodeKind: text('node_kind').notNull(),
    status: text('status').notNull().default('pending'),
    /** Last attempt number (1-based). */
    attempt: integer('attempt').notNull().default(1),
    /** Sanitized — the engine strips secrets before persisting. */
    input: jsonb('input'),
    output: jsonb('output'),
    error: jsonb('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('workflow_execution_steps_unique').on(t.workflowExecutionId, t.nodeId),
    index('workflow_execution_steps_org_exec_idx').on(t.organizationId, t.workflowExecutionId),
    check(
      'workflow_execution_steps_status_check',
      sql`${t.status} IN ('pending', 'running', 'succeeded', 'failed', 'skipped')`,
    ),
  ],
);

/** Append-only. Partition by month when volume demands it (ARCHITECTURE.md §7). */
export const workflowExecutionLogs = pgTable(
  'workflow_execution_logs',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workflowExecutionId: uuid('workflow_execution_id')
      .notNull()
      .references(() => workflowExecutions.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id').references(() => workflowExecutionSteps.id, { onDelete: 'cascade' }),
    level: text('level').notNull(),
    /** Already redacted by observability before reaching the database. */
    message: text('message').notNull(),
    fields: jsonb('fields'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('workflow_execution_logs_exec_idx').on(t.workflowExecutionId, t.createdAt),
    check(
      'workflow_execution_logs_level_check',
      sql`${t.level} IN ('debug', 'info', 'warn', 'error')`,
    ),
  ],
);

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workflowExecutionId: uuid('workflow_execution_id')
      .notNull()
      .references(() => workflowExecutions.id),
    nodeId: text('node_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    /** Data for the human to review (sanitized). */
    payload: jsonb('payload'),
    requiredRole: text('required_role').notNull().default('member'),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id),
    status: text('status').notNull().default('pending'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionComment: text('resolution_comment'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('approval_requests_org_status_idx').on(t.organizationId, t.status),
    index('approval_requests_assignee_idx').on(t.assigneeUserId, t.status),
    check(
      'approval_requests_status_check',
      sql`${t.status} IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')`,
    ),
    check(
      'approval_requests_role_check',
      sql`${t.requiredRole} IN ('owner', 'admin', 'member', 'viewer')`,
    ),
  ],
);
