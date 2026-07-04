import type { ExecutionStatus, StepStatus } from './execution.js';

/**
 * Persistence port of the engine. The engine never touches the database
 * directly — the worker provides a Drizzle-backed implementation and tests
 * provide an in-memory one. Every method is already tenant-scoped because
 * the store is constructed per execution load (the executionId is the key
 * and the store implementation re-checks organization ownership).
 */

export interface StepRecord {
  nodeId: string;
  nodeKind: string;
  status: StepStatus;
  attempt: number;
  output?: unknown;
  /** Branch taken (condition/approval nodes) — needed to resume traversal. */
  branch?: string | null;
  error?: { code: string; message: string } | null;
}

export interface LoadedExecution {
  executionId: string;
  organizationId: string;
  /** User that triggered the run; null for system triggers. */
  createdByUserId: string | null;
  status: ExecutionStatus;
  /** Raw definition jsonb — the executor validates it with the schema. */
  definition: unknown;
  /** Installation-level variable overrides (installed_workflows.config.variables). */
  configVariables: Record<string, unknown>;
  context: Record<string, unknown>;
  steps: StepRecord[];
}

export interface ApprovalRequestInput {
  nodeId: string;
  title: string;
  description?: string;
  payload?: unknown;
  requiredRole: 'owner' | 'admin' | 'member' | 'viewer';
  expiresAt?: Date;
}

export type ApprovalOutcome = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';

export interface ExecutionStore {
  load(executionId: string): Promise<LoadedExecution | null>;
  updateExecution(
    executionId: string,
    patch: {
      status?: ExecutionStatus;
      context?: Record<string, unknown>;
      currentNodeId?: string | null;
      error?: { code: string; message: string } | null;
      startedAt?: Date;
      finishedAt?: Date;
    },
  ): Promise<void>;
  upsertStep(executionId: string, step: StepRecord): Promise<void>;
  appendLog(
    executionId: string,
    log: {
      nodeId?: string;
      level: 'debug' | 'info' | 'warn' | 'error';
      message: string;
      fields?: Record<string, unknown>;
    },
  ): Promise<void>;
  /** Creates the approval request when an approval node first pauses. */
  createApprovalRequest(executionId: string, input: ApprovalRequestInput): Promise<string>;
  /** Latest approval outcome for a node of this execution, null if none exists. */
  getApprovalOutcome(executionId: string, nodeId: string): Promise<ApprovalOutcome | null>;
}
