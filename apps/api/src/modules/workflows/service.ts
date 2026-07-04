import type { Db } from '@flowhub/database';
import { schema } from '@flowhub/database';
import { AppError, type TenantContext } from '@flowhub/shared';
import { parseWorkflowDefinition, type WorkflowDefinition } from '@flowhub/workflow-engine';
import { and, eq } from 'drizzle-orm';

/**
 * Creates an installed workflow with version 1 (current) and regenerates the
 * denormalized node/edge projection. Single write path for both "install from
 * template" and "create from JSON".
 */
export async function createInstalledWorkflow(
  db: Db,
  tenant: TenantContext,
  input: {
    name: string;
    definition: WorkflowDefinition;
    workflowTemplateVersionId?: string | null;
  },
): Promise<{ installedWorkflowId: string; workflowVersionId: string }> {
  const [installed] = await db
    .insert(schema.installedWorkflows)
    .values({
      organizationId: tenant.organizationId,
      workflowTemplateVersionId: input.workflowTemplateVersionId ?? null,
      name: input.name,
      status: 'active',
      createdBy: tenant.userId,
    })
    .returning();
  if (!installed) throw new AppError('INTERNAL_ERROR', 'Failed to install workflow');

  const [version] = await db
    .insert(schema.workflowVersions)
    .values({
      organizationId: tenant.organizationId,
      installedWorkflowId: installed.id,
      version: 1,
      definition: input.definition,
      isCurrent: true,
      createdBy: tenant.userId,
    })
    .returning();
  if (!version) throw new AppError('INTERNAL_ERROR', 'Failed to create workflow version');

  await regenerateProjection(db, tenant, version.id, input.definition);
  return { installedWorkflowId: installed.id, workflowVersionId: version.id };
}

/** Rebuilds workflow_nodes / workflow_edges for a version from its definition. */
export async function regenerateProjection(
  db: Db,
  tenant: TenantContext,
  workflowVersionId: string,
  definition: WorkflowDefinition,
): Promise<void> {
  await db
    .delete(schema.workflowNodes)
    .where(eq(schema.workflowNodes.workflowVersionId, workflowVersionId));
  await db
    .delete(schema.workflowEdges)
    .where(eq(schema.workflowEdges.workflowVersionId, workflowVersionId));
  if (definition.nodes.length > 0) {
    await db.insert(schema.workflowNodes).values(
      definition.nodes.map((node) => ({
        organizationId: tenant.organizationId,
        workflowVersionId,
        nodeId: node.id,
        kind: node.kind,
        name: node.name,
        config: node.config,
      })),
    );
  }
  if (definition.edges.length > 0) {
    await db.insert(schema.workflowEdges).values(
      definition.edges.map((edge) => ({
        organizationId: tenant.organizationId,
        workflowVersionId,
        fromNodeId: edge.from,
        toNodeId: edge.to,
        branch: edge.branch ?? null,
      })),
    );
  }
}

/** Loads an installed workflow, tenant-scoped. NOT_FOUND hides foreign rows. */
export async function getInstalledWorkflow(db: Db, tenant: TenantContext, id: string) {
  const [installed] = await db
    .select()
    .from(schema.installedWorkflows)
    .where(
      and(
        eq(schema.installedWorkflows.id, id),
        eq(schema.installedWorkflows.organizationId, tenant.organizationId),
      ),
    );
  if (!installed || installed.deletedAt) throw new AppError('NOT_FOUND', 'Workflow not found');
  return installed;
}

/** Loads the current version of an installed workflow, tenant-scoped. */
export async function getCurrentVersion(
  db: Db,
  tenant: TenantContext,
  installedWorkflowId: string,
) {
  const [version] = await db
    .select()
    .from(schema.workflowVersions)
    .where(
      and(
        eq(schema.workflowVersions.installedWorkflowId, installedWorkflowId),
        eq(schema.workflowVersions.organizationId, tenant.organizationId),
        eq(schema.workflowVersions.isCurrent, true),
      ),
    );
  if (!version) throw new AppError('INTERNAL_ERROR', 'Installed workflow has no current version');
  return { ...version, definition: parseWorkflowDefinition(version.definition) };
}
