import type { TenantContext } from '@flowhub/shared';

/**
 * Execution model types. State machine and semantics are specified in
 * docs/architecture/WORKFLOW_ENGINE.md — keep both in sync.
 */

export const EXECUTION_STATUSES = [
  'pending', // created, not yet picked up by a worker
  'running',
  'waiting', // paused on a wait node
  'waiting_approval', // paused on an approval node
  'succeeded',
  'failed',
  'cancelled',
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const STEP_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'skipped'] as const;

export type StepStatus = (typeof STEP_STATUSES)[number];

/**
 * Mutable data bag flowing through an execution. Node outputs are stored
 * under their node id; nodes read upstream outputs from here.
 */
export type ExecutionContextData = Record<string, unknown>;

/** What a node handler receives when executed. */
export interface NodeExecutionInput {
  readonly tenant: TenantContext;
  readonly executionId: string;
  readonly nodeId: string;
  readonly config: Record<string, unknown>;
  readonly data: ExecutionContextData;
  /** Monotonic attempt counter, 1-based. Handlers must be idempotent across attempts. */
  readonly attempt: number;
}

/** What a node handler returns. */
export type NodeExecutionOutput =
  | { status: 'succeeded'; output: unknown; branch?: string }
  | { status: 'failed'; error: { code: string; message: string }; retryable: boolean }
  | { status: 'waiting'; resumeAt?: string } // ISO timestamp for wait nodes
  | { status: 'waiting_approval'; approvalRequestId: string };

/**
 * Contract every node handler implements. Handlers are registered per
 * NodeKind (and per connector action for `action` nodes). Cycle 6 ships
 * the executor that drives these.
 */
export interface NodeHandler {
  readonly kind: string;
  execute(input: NodeExecutionInput): Promise<NodeExecutionOutput>;
}
