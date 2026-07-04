import type { Db } from '@flowhub/database';
import { schema } from '@flowhub/database';
import type {
  ApprovalOutcome,
  ApprovalRequestInput,
  ExecutionStore,
  LoadedExecution,
  StepRecord,
} from '@flowhub/workflow-engine';
import { and, desc, eq } from 'drizzle-orm';

/**
 * Drizzle-backed ExecutionStore. Every write re-scopes by the execution's
 * organization (cached at load) — defense in depth against cross-tenant
 * writes even if a job payload were forged (SECURITY_MODEL.md §4).
 */
export class DrizzleExecutionStore implements ExecutionStore {
  private readonly orgByExecution = new Map<string, string>();

  constructor(private readonly db: Db) {}

  private async organizationOf(executionId: string): Promise<string> {
    const cached = this.orgByExecution.get(executionId);
    if (cached) return cached;
    const [row] = await this.db
      .select({ organizationId: schema.workflowExecutions.organizationId })
      .from(schema.workflowExecutions)
      .where(eq(schema.workflowExecutions.id, executionId));
    if (!row) throw new Error(`execution not found: ${executionId}`);
    this.orgByExecution.set(executionId, row.organizationId);
    return row.organizationId;
  }

  async load(executionId: string): Promise<LoadedExecution | null> {
    const [row] = await this.db
      .select({
        execution: schema.workflowExecutions,
        definition: schema.workflowVersions.definition,
        installedConfig: schema.installedWorkflows.config,
      })
      .from(schema.workflowExecutions)
      .innerJoin(
        schema.workflowVersions,
        eq(schema.workflowExecutions.workflowVersionId, schema.workflowVersions.id),
      )
      .innerJoin(
        schema.installedWorkflows,
        eq(schema.workflowExecutions.installedWorkflowId, schema.installedWorkflows.id),
      )
      .where(eq(schema.workflowExecutions.id, executionId));
    if (!row) return null;

    this.orgByExecution.set(executionId, row.execution.organizationId);

    const steps = await this.db
      .select()
      .from(schema.workflowExecutionSteps)
      .where(
        and(
          eq(schema.workflowExecutionSteps.workflowExecutionId, executionId),
          eq(schema.workflowExecutionSteps.organizationId, row.execution.organizationId),
        ),
      );

    const installedConfig = (row.installedConfig ?? {}) as { variables?: Record<string, unknown> };
    return {
      executionId,
      organizationId: row.execution.organizationId,
      createdByUserId: row.execution.createdBy,
      status: row.execution.status as LoadedExecution['status'],
      definition: row.definition,
      configVariables: installedConfig.variables ?? {},
      context: (row.execution.context ?? {}) as Record<string, unknown>,
      steps: steps.map((s) => ({
        nodeId: s.nodeId,
        nodeKind: s.nodeKind,
        status: s.status as StepRecord['status'],
        attempt: s.attempt,
        ...(s.output !== null ? { output: s.output } : {}),
        branch: s.branch,
        error: (s.error ?? null) as { code: string; message: string } | null,
      })),
    };
  }

  async updateExecution(
    executionId: string,
    patch: Parameters<ExecutionStore['updateExecution']>[1],
  ): Promise<void> {
    const organizationId = await this.organizationOf(executionId);
    await this.db
      .update(schema.workflowExecutions)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.context !== undefined ? { context: patch.context } : {}),
        ...(patch.currentNodeId !== undefined ? { currentNodeId: patch.currentNodeId } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
        ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
      })
      .where(
        and(
          eq(schema.workflowExecutions.id, executionId),
          eq(schema.workflowExecutions.organizationId, organizationId),
        ),
      );
  }

  async upsertStep(executionId: string, step: StepRecord): Promise<void> {
    const organizationId = await this.organizationOf(executionId);
    const now = new Date();
    await this.db
      .insert(schema.workflowExecutionSteps)
      .values({
        organizationId,
        workflowExecutionId: executionId,
        nodeId: step.nodeId,
        nodeKind: step.nodeKind,
        status: step.status,
        attempt: step.attempt,
        output: step.output ?? null,
        branch: step.branch ?? null,
        error: step.error ?? null,
        startedAt: now,
        ...(step.status === 'succeeded' || step.status === 'failed' ? { finishedAt: now } : {}),
      })
      .onConflictDoUpdate({
        target: [
          schema.workflowExecutionSteps.workflowExecutionId,
          schema.workflowExecutionSteps.nodeId,
        ],
        set: {
          status: step.status,
          attempt: step.attempt,
          output: step.output ?? null,
          branch: step.branch ?? null,
          error: step.error ?? null,
          ...(step.status === 'succeeded' || step.status === 'failed'
            ? { finishedAt: now }
            : { finishedAt: null }),
        },
      });
  }

  async appendLog(
    executionId: string,
    log: Parameters<ExecutionStore['appendLog']>[1],
  ): Promise<void> {
    const organizationId = await this.organizationOf(executionId);
    let stepId: string | null = null;
    if (log.nodeId) {
      const [step] = await this.db
        .select({ id: schema.workflowExecutionSteps.id })
        .from(schema.workflowExecutionSteps)
        .where(
          and(
            eq(schema.workflowExecutionSteps.workflowExecutionId, executionId),
            eq(schema.workflowExecutionSteps.nodeId, log.nodeId),
          ),
        );
      stepId = step?.id ?? null;
    }
    await this.db.insert(schema.workflowExecutionLogs).values({
      organizationId,
      workflowExecutionId: executionId,
      stepId,
      level: log.level,
      message: log.message,
      fields: log.fields ?? null,
    });
  }

  async createApprovalRequest(executionId: string, input: ApprovalRequestInput): Promise<string> {
    const organizationId = await this.organizationOf(executionId);
    const [row] = await this.db
      .insert(schema.approvalRequests)
      .values({
        organizationId,
        workflowExecutionId: executionId,
        nodeId: input.nodeId,
        title: input.title,
        description: input.description ?? null,
        payload: input.payload ?? null,
        requiredRole: input.requiredRole,
        status: 'pending',
        expiresAt: input.expiresAt ?? null,
      })
      .returning({ id: schema.approvalRequests.id });
    if (!row) throw new Error('failed to create approval request');
    return row.id;
  }

  async getApprovalOutcome(executionId: string, nodeId: string): Promise<ApprovalOutcome | null> {
    const organizationId = await this.organizationOf(executionId);
    const [row] = await this.db
      .select({ status: schema.approvalRequests.status })
      .from(schema.approvalRequests)
      .where(
        and(
          eq(schema.approvalRequests.workflowExecutionId, executionId),
          eq(schema.approvalRequests.nodeId, nodeId),
          eq(schema.approvalRequests.organizationId, organizationId),
        ),
      )
      .orderBy(desc(schema.approvalRequests.createdAt))
      .limit(1);
    return (row?.status as ApprovalOutcome | undefined) ?? null;
  }
}
