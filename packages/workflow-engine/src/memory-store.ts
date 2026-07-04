import type { ExecutionStatus } from './execution.js';
import type {
  ApprovalOutcome,
  ApprovalRequestInput,
  ExecutionStore,
  LoadedExecution,
  StepRecord,
} from './store.js';

/**
 * In-memory ExecutionStore for engine tests and local experimentation.
 * Mirrors the semantics the Drizzle store implements against PostgreSQL.
 */
export class InMemoryExecutionStore implements ExecutionStore {
  readonly executions = new Map<
    string,
    {
      organizationId: string;
      createdByUserId: string | null;
      status: ExecutionStatus;
      definition: unknown;
      configVariables: Record<string, unknown>;
      context: Record<string, unknown>;
      currentNodeId: string | null;
      error: { code: string; message: string } | null;
      startedAt: Date | null;
      finishedAt: Date | null;
    }
  >();

  readonly steps = new Map<string, Map<string, StepRecord>>();
  readonly logs: Array<{ executionId: string; nodeId?: string; level: string; message: string }> =
    [];
  readonly approvals = new Map<
    string,
    { id: string; input: ApprovalRequestInput; outcome: ApprovalOutcome }
  >();

  private approvalCounter = 0;

  seedExecution(
    executionId: string,
    definition: unknown,
    options?: {
      configVariables?: Record<string, unknown>;
      organizationId?: string;
    },
  ): void {
    this.executions.set(executionId, {
      organizationId: options?.organizationId ?? 'org-test',
      createdByUserId: 'user-test',
      status: 'pending',
      definition,
      configVariables: options?.configVariables ?? {},
      context: {},
      currentNodeId: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    });
    this.steps.set(executionId, new Map());
  }

  async load(executionId: string): Promise<LoadedExecution | null> {
    const execution = this.executions.get(executionId);
    if (!execution) return null;
    return {
      executionId,
      organizationId: execution.organizationId,
      createdByUserId: execution.createdByUserId,
      status: execution.status,
      definition: execution.definition,
      configVariables: execution.configVariables,
      context: execution.context,
      steps: [...(this.steps.get(executionId)?.values() ?? [])],
    };
  }

  async updateExecution(
    executionId: string,
    patch: Parameters<ExecutionStore['updateExecution']>[1],
  ): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`unknown execution ${executionId}`);
    if (patch.status !== undefined) execution.status = patch.status;
    if (patch.context !== undefined) execution.context = patch.context;
    if (patch.currentNodeId !== undefined) execution.currentNodeId = patch.currentNodeId;
    if (patch.error !== undefined) execution.error = patch.error;
    if (patch.startedAt !== undefined) execution.startedAt = patch.startedAt;
    if (patch.finishedAt !== undefined) execution.finishedAt = patch.finishedAt;
  }

  async upsertStep(executionId: string, step: StepRecord): Promise<void> {
    const stepMap = this.steps.get(executionId);
    if (!stepMap) throw new Error(`unknown execution ${executionId}`);
    stepMap.set(step.nodeId, step);
  }

  async appendLog(
    executionId: string,
    log: { nodeId?: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string },
  ): Promise<void> {
    this.logs.push({
      executionId,
      ...(log.nodeId ? { nodeId: log.nodeId } : {}),
      level: log.level,
      message: log.message,
    });
  }

  async createApprovalRequest(executionId: string, input: ApprovalRequestInput): Promise<string> {
    const id = `approval-${++this.approvalCounter}`;
    this.approvals.set(`${executionId}:${input.nodeId}`, { id, input, outcome: 'pending' });
    return id;
  }

  async getApprovalOutcome(executionId: string, nodeId: string): Promise<ApprovalOutcome | null> {
    return this.approvals.get(`${executionId}:${nodeId}`)?.outcome ?? null;
  }

  /** Test helper: resolve a pending approval. */
  resolveApproval(executionId: string, nodeId: string, outcome: ApprovalOutcome): void {
    const approval = this.approvals.get(`${executionId}:${nodeId}`);
    if (!approval) throw new Error('no approval to resolve');
    approval.outcome = outcome;
  }
}
