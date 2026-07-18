import type { Connector } from '@flowhub/connectors';
import type { Logger } from '@flowhub/observability';
import { isAppError } from '@flowhub/shared';

import { evaluateCondition } from './condition.js';
import {
  parseWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowNode,
} from './definition.js';
import { interpolateString, interpolateValue, type InterpolationScope } from './interpolate.js';
import type { ExecutionStore, LoadedExecution, StepRecord } from './store.js';

/** Default retry policy (WORKFLOW_ENGINE.md §4): 3 attempts, 5s/25s/125s. */
const DEFAULT_MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5000;

/**
 * AI port of the engine. Satisfied by AiGateway (production) and by
 * providerPort(MockAiProvider) in tests — the engine never talks to an AI
 * SDK or provider directly (ADR-0007).
 */
export interface EngineAiPort {
  call(input: {
    organizationId: string;
    executionId?: string;
    promptTemplateId: string;
    variables: Record<string, string>;
  }): Promise<{ output: unknown }>;
}

export interface ExecutorDeps {
  store: ExecutionStore;
  connectors: Map<string, Connector>;
  ai: EngineAiPort;
  logger: Logger;
  /** Called when a wait node pauses the execution; wires to JobQueue.schedule. */
  scheduleResume?: (executionId: string, resumeAt: Date) => Promise<void>;
  /** Injectable for tests — production uses real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for tests. */
  now?: () => Date;
}

type NodeOutcome =
  | { kind: 'succeeded'; output: unknown; branch?: string }
  | { kind: 'failed'; error: { code: string; message: string }; retryable: boolean }
  | { kind: 'waiting'; resumeAt: Date }
  | { kind: 'waiting_approval' };

/**
 * Runs (or resumes) a workflow execution to its next pause or terminal state.
 * Re-entrant: completed steps are never re-executed (context snapshots +
 * step records make resumption safe after crash, wait or approval).
 */
export async function runExecution(executionId: string, deps: ExecutorDeps): Promise<void> {
  const { store } = deps;
  const logger = deps.logger.child({ executionId });
  const now = deps.now ?? (() => new Date());

  const loaded = await store.load(executionId);
  if (!loaded) {
    logger.error('execution not found', {});
    return;
  }
  if (['succeeded', 'failed', 'cancelled'].includes(loaded.status)) {
    logger.info('execution already terminal, nothing to do', { status: loaded.status });
    return;
  }

  let definition: WorkflowDefinition;
  try {
    definition = parseWorkflowDefinition(loaded.definition);
  } catch (error) {
    await failExecution(deps, executionId, {
      code: 'EXECUTION_ERROR',
      message: `Persisted definition is invalid: ${(error as Error).message}`,
    });
    return;
  }

  const nodesById = new Map(definition.nodes.map((n) => [n.id, n]));
  const trigger = definition.nodes.find((n) => n.kind === 'trigger');
  if (!trigger) {
    await failExecution(deps, executionId, {
      code: 'EXECUTION_ERROR',
      message: 'Definition has no trigger node',
    });
    return;
  }

  // Context: variables = definition defaults overridden by installation config.
  const context = { ...loaded.context } as {
    variables?: Record<string, unknown>;
    nodes?: Record<string, unknown>;
    trigger?: unknown;
  };
  context.variables = {
    ...definition.variables,
    ...loaded.configVariables,
    ...(context.variables ?? {}),
  };
  context.nodes = context.nodes ?? {};

  const steps = new Map(loaded.steps.map((s) => [s.nodeId, s]));

  await store.updateExecution(executionId, {
    status: 'running',
    ...(loaded.status === 'pending' ? { startedAt: now() } : {}),
  });
  await store.appendLog(executionId, {
    level: 'info',
    message: loaded.status === 'pending' ? 'execution started' : 'execution resumed',
  });

  let currentNode: WorkflowNode | undefined =
    (steps.size > 0 || loaded.status !== 'pending') && firstUnfinished(definition, steps)
      ? firstUnfinished(definition, steps)
      : trigger;

  while (currentNode) {
    const node: WorkflowNode = currentNode;
    const existing = steps.get(node.id);
    let outcome: NodeOutcome;

    if (existing?.status === 'succeeded') {
      outcome = {
        kind: 'succeeded',
        output: existing.output,
        ...(existing.branch != null ? { branch: existing.branch } : {}),
      };
    } else {
      outcome = await executeWithRetries(node, existing, loaded, context, deps, executionId);
    }

    if (outcome.kind === 'failed') {
      await store.upsertStep(executionId, {
        nodeId: node.id,
        nodeKind: node.kind,
        status: 'failed',
        attempt: (existing?.attempt ?? 0) + 1,
        error: outcome.error,
      });
      await store.appendLog(executionId, {
        nodeId: node.id,
        level: 'error',
        message: `node failed: ${outcome.error.message}`,
        fields: { code: outcome.error.code },
      });
      await failExecution(deps, executionId, outcome.error, node.id);
      return;
    }

    if (outcome.kind === 'waiting') {
      await store.upsertStep(executionId, {
        nodeId: node.id,
        nodeKind: node.kind,
        status: 'pending',
        attempt: existing?.attempt ?? 1,
        output: { resumeAt: outcome.resumeAt.toISOString() },
      });
      await store.updateExecution(executionId, {
        status: 'waiting',
        currentNodeId: node.id,
        context: context as Record<string, unknown>,
      });
      await store.appendLog(executionId, {
        nodeId: node.id,
        level: 'info',
        message: `execution waiting until ${outcome.resumeAt.toISOString()}`,
      });
      await deps.scheduleResume?.(executionId, outcome.resumeAt);
      return;
    }

    if (outcome.kind === 'waiting_approval') {
      await store.upsertStep(executionId, {
        nodeId: node.id,
        nodeKind: node.kind,
        status: 'pending',
        attempt: existing?.attempt ?? 1,
      });
      await store.updateExecution(executionId, {
        status: 'waiting_approval',
        currentNodeId: node.id,
        context: context as Record<string, unknown>,
      });
      await store.appendLog(executionId, {
        nodeId: node.id,
        level: 'info',
        message: 'execution paused for human approval',
      });
      return;
    }

    // Succeeded.
    if (existing?.status !== 'succeeded') {
      context.nodes[node.id] = outcome.output;
      await store.upsertStep(executionId, {
        nodeId: node.id,
        nodeKind: node.kind,
        status: 'succeeded',
        attempt: (existing?.attempt ?? 0) + 1,
        output: outcome.output,
        branch: outcome.branch ?? null,
      });
      steps.set(node.id, {
        nodeId: node.id,
        nodeKind: node.kind,
        status: 'succeeded',
        attempt: (existing?.attempt ?? 0) + 1,
        output: outcome.output,
        branch: outcome.branch ?? null,
      });
      await store.updateExecution(executionId, {
        context: context as Record<string, unknown>,
        currentNodeId: node.id,
      });
      await store.appendLog(executionId, {
        nodeId: node.id,
        level: 'info',
        message: `node succeeded${outcome.branch ? ` (branch: ${outcome.branch})` : ''}`,
      });
    }

    const next = findNext(definition, node.id, outcome.branch);
    if (next === 'invalid') {
      await failExecution(
        deps,
        executionId,
        {
          code: 'EXECUTION_ERROR',
          message: `No edge matches branch '${outcome.branch ?? ''}' from node '${node.id}'`,
        },
        node.id,
      );
      return;
    }
    currentNode = next ? nodesById.get(next) : undefined;
  }

  await store.updateExecution(executionId, {
    status: 'succeeded',
    finishedAt: now(),
    context: context as Record<string, unknown>,
  });
  await store.appendLog(executionId, { level: 'info', message: 'execution succeeded' });
}

/** First node in definition order without a succeeded step — resume point. */
function firstUnfinished(
  definition: WorkflowDefinition,
  steps: Map<string, StepRecord>,
): WorkflowNode | undefined {
  for (const node of definition.nodes) {
    const step = steps.get(node.id);
    if (step && step.status !== 'succeeded') return node;
  }
  return undefined;
}

/** Resolves the next node id, undefined for end-of-flow, 'invalid' on branch mismatch. */
function findNext(
  definition: WorkflowDefinition,
  fromNodeId: string,
  branch: string | undefined,
): string | undefined | 'invalid' {
  const outgoing = definition.edges.filter((e) => e.from === fromNodeId);
  if (outgoing.length === 0) return undefined;
  if (branch !== undefined) {
    const matching = outgoing.find((e) => e.branch === branch);
    return matching ? matching.to : 'invalid';
  }
  const unbranched = outgoing.find((e) => e.branch === undefined);
  return unbranched ? unbranched.to : 'invalid';
}

async function failExecution(
  deps: ExecutorDeps,
  executionId: string,
  error: { code: string; message: string },
  nodeId?: string,
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  await deps.store.updateExecution(executionId, {
    status: 'failed',
    error,
    finishedAt: now(),
    ...(nodeId ? { currentNodeId: nodeId } : {}),
  });
  await deps.store.appendLog(executionId, {
    level: 'error',
    message: `execution failed: ${error.message}`,
    fields: { code: error.code },
  });
}

async function executeWithRetries(
  node: WorkflowNode,
  existing: StepRecord | undefined,
  loaded: LoadedExecution,
  context: {
    variables?: Record<string, unknown>;
    nodes?: Record<string, unknown>;
    trigger?: unknown;
  },
  deps: ExecutorDeps,
  executionId: string,
): Promise<NodeOutcome> {
  const maxAttempts =
    typeof node.config['retries'] === 'number'
      ? Math.max(1, Math.min(5, node.config['retries'] as number))
      : DEFAULT_MAX_ATTEMPTS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let attempt = existing?.attempt ?? 0;
  for (;;) {
    attempt += 1;
    await deps.store.appendLog(executionId, {
      nodeId: node.id,
      level: 'debug',
      message: `executing node (attempt ${attempt})`,
    });
    const outcome = await executeNode(node, existing, loaded, context, deps, executionId);
    if (outcome.kind === 'failed' && outcome.retryable && attempt < maxAttempts) {
      const delay = BACKOFF_BASE_MS * 5 ** (attempt - 1);
      await deps.store.appendLog(executionId, {
        nodeId: node.id,
        level: 'warn',
        message: `retryable failure, retrying in ${delay}ms: ${outcome.error.message}`,
        fields: { attempt },
      });
      await deps.store.upsertStep(executionId, {
        nodeId: node.id,
        nodeKind: node.kind,
        status: 'running',
        attempt,
        error: outcome.error,
      });
      await sleep(delay);
      continue;
    }
    return outcome;
  }
}

async function executeNode(
  node: WorkflowNode,
  existing: StepRecord | undefined,
  loaded: LoadedExecution,
  context: {
    variables?: Record<string, unknown>;
    nodes?: Record<string, unknown>;
    trigger?: unknown;
  },
  deps: ExecutorDeps,
  executionId: string,
): Promise<NodeOutcome> {
  const scope: InterpolationScope = {
    nodes: context.nodes ?? {},
    variables: context.variables ?? {},
    ...(context.trigger !== undefined ? { trigger: context.trigger } : {}),
  };
  const now = deps.now ?? (() => new Date());

  try {
    switch (node.kind) {
      case 'trigger':
        return { kind: 'succeeded', output: context.trigger ?? {} };

      case 'transform': {
        const assignments = interpolateValue(node.config['assign'] ?? {}, scope);
        return { kind: 'succeeded', output: assignments };
      }

      case 'condition': {
        const rawExpression = node.config['expression'];
        if (typeof rawExpression !== 'string') {
          return {
            kind: 'failed',
            error: { code: 'EXECUTION_ERROR', message: 'condition node missing expression' },
            retryable: false,
          };
        }
        const interpolated = String(interpolateString(rawExpression, scope));
        const result = evaluateCondition(interpolated);
        return {
          kind: 'succeeded',
          output: { expression: interpolated, result },
          branch: result ? 'true' : 'false',
        };
      }

      case 'wait': {
        const previous = existing?.output as { resumeAt?: string } | undefined;
        if (previous?.resumeAt && new Date(previous.resumeAt).getTime() <= now().getTime()) {
          return { kind: 'succeeded', output: { waitedUntil: previous.resumeAt } };
        }
        if (previous?.resumeAt) {
          // Woken early — keep waiting until the recorded time.
          return { kind: 'waiting', resumeAt: new Date(previous.resumeAt) };
        }
        const seconds = Number(node.config['durationSeconds'] ?? 60);
        return { kind: 'waiting', resumeAt: new Date(now().getTime() + seconds * 1000) };
      }

      case 'approval': {
        const outcome = await deps.store.getApprovalOutcome(executionId, node.id);
        if (outcome === 'approved' || outcome === 'rejected' || outcome === 'expired') {
          return { kind: 'succeeded', output: { outcome }, branch: outcome };
        }
        if (outcome === 'pending') return { kind: 'waiting_approval' };
        // No request yet — create it and pause.
        const title = String(interpolateString(String(node.config['title'] ?? node.name), scope));
        const requiredRole = (node.config['requiredRole'] ?? 'member') as
          'owner' | 'admin' | 'member' | 'viewer';
        const payloadFrom = node.config['payloadFrom'];
        const payload =
          typeof payloadFrom === 'string' ? (context.nodes ?? {})[payloadFrom] : undefined;
        const expiresInHours = Number(node.config['expiresInHours'] ?? 0);
        await deps.store.createApprovalRequest(executionId, {
          nodeId: node.id,
          title,
          requiredRole,
          payload,
          ...(expiresInHours > 0
            ? { expiresAt: new Date(now().getTime() + expiresInHours * 3600 * 1000) }
            : {}),
        });
        return { kind: 'waiting_approval' };
      }

      case 'action': {
        const connectorSlug = String(node.config['connector'] ?? '');
        const connector = deps.connectors.get(connectorSlug);
        if (!connector) {
          return {
            kind: 'failed',
            error: { code: 'CONNECTOR_ERROR', message: `Unknown connector: ${connectorSlug}` },
            retryable: false,
          };
        }
        const params = interpolateValue(node.config['params'] ?? {}, scope) as Record<
          string,
          unknown
        >;
        const accountId = node.config['connectorAccountId'];
        const result = await connector.execute({
          tenant: {
            organizationId: loaded.organizationId as never,
            userId: (loaded.createdByUserId ?? '00000000-0000-0000-0000-000000000000') as never,
            role: 'member',
          },
          action: String(node.config['action'] ?? ''),
          params,
          ...(typeof accountId === 'string' ? { connectorAccountId: accountId } : {}),
        });
        if (!result.ok) {
          return { kind: 'failed', error: result.error, retryable: result.retryable };
        }
        return { kind: 'succeeded', output: result.output };
      }

      case 'ai': {
        const promptTemplateId = String(node.config['promptTemplate'] ?? '');
        if (!promptTemplateId) {
          return {
            kind: 'failed',
            error: { code: 'AI_PROVIDER_ERROR', message: 'ai node missing promptTemplate' },
            retryable: false,
          };
        }
        const input = interpolateValue(node.config['input'] ?? {}, scope) as Record<
          string,
          unknown
        >;
        try {
          const response = await deps.ai.call({
            organizationId: loaded.organizationId,
            executionId,
            promptTemplateId,
            variables: Object.fromEntries(
              Object.entries(input).map(([k, v]) => [
                k,
                typeof v === 'string' ? v : JSON.stringify(v),
              ]),
            ),
          });
          return { kind: 'succeeded', output: response.output };
        } catch (error) {
          if (isAppError(error)) {
            // Transient provider failures retry; budget caps, bad templates
            // and schema mismatches do not.
            const retryable = error.code === 'AI_PROVIDER_ERROR' && !/schema/.test(error.message);
            return {
              kind: 'failed',
              error: { code: error.code, message: error.message },
              retryable,
            };
          }
          throw error;
        }
      }

      default:
        return {
          kind: 'failed',
          error: { code: 'EXECUTION_ERROR', message: `Unknown node kind: ${node.kind as string}` },
          retryable: false,
        };
    }
  } catch (error) {
    // Uncontrolled exception: not retryable (might not be idempotent).
    return {
      kind: 'failed',
      error: { code: 'INTERNAL_ERROR', message: (error as Error).message },
      retryable: false,
    };
  }
}
