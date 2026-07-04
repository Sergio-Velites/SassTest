import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { workflowTemplateVersions } from './catalog.js';
import { id, softDelete, timestamps } from './helpers.js';
import { organizations, users } from './identity.js';

export const installedWorkflows = pgTable(
  'installed_workflows',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** NULL when the workflow was created from raw JSON instead of a template. */
    workflowTemplateVersionId: uuid('workflow_template_version_id').references(
      () => workflowTemplateVersions.id,
    ),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    /** Variable values + connector account mapping for this installation. */
    config: jsonb('config').notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('installed_workflows_org_status_idx').on(t.organizationId, t.status),
    check('installed_workflows_status_check', sql`${t.status} IN ('active', 'paused', 'archived')`),
  ],
);

export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: id(),
    /** Denormalized for direct tenant isolation checks. */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    installedWorkflowId: uuid('installed_workflow_id')
      .notNull()
      .references(() => installedWorkflows.id),
    /** Auto-incremented per installation (application-managed). */
    version: integer('version').notNull(),
    /** Executable source of truth (validated by workflowDefinitionSchema). */
    definition: jsonb('definition').notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('workflow_versions_unique').on(t.installedWorkflowId, t.version),
    // Exactly one current version per installation.
    uniqueIndex('workflow_versions_current_unique')
      .on(t.installedWorkflowId)
      .where(sql`${t.isCurrent} = true`),
  ],
);

/**
 * Denormalized projection of the jsonb definition for queries and the editor.
 * Regenerated whenever a version is saved — never edited row by row.
 */
export const workflowNodes = pgTable(
  'workflow_nodes',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workflowVersionId: uuid('workflow_version_id')
      .notNull()
      .references(() => workflowVersions.id, { onDelete: 'cascade' }),
    /** Slug inside the definition, not a UUID. */
    nodeId: text('node_id').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('workflow_nodes_unique').on(t.workflowVersionId, t.nodeId),
    check(
      'workflow_nodes_kind_check',
      sql`${t.kind} IN ('trigger', 'action', 'condition', 'ai', 'approval', 'wait', 'transform')`,
    ),
  ],
);

export const workflowEdges = pgTable(
  'workflow_edges',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workflowVersionId: uuid('workflow_version_id')
      .notNull()
      .references(() => workflowVersions.id, { onDelete: 'cascade' }),
    fromNodeId: text('from_node_id').notNull(),
    toNodeId: text('to_node_id').notNull(),
    branch: text('branch'),
    ...timestamps,
  },
  (t) => [index('workflow_edges_version_idx').on(t.workflowVersionId)],
);
