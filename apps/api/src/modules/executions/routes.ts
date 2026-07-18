import type { Db } from '@flowhub/database';
import { schema } from '@flowhub/database';
import type { JobQueue } from '@flowhub/jobs';
import type { Logger } from '@flowhub/observability';
import { AppError } from '@flowhub/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { writeAudit } from '../../lib/audit.js';
import { assertWithinPlanLimits } from '../../lib/limits.js';
import { OrgRateLimiter } from '../../lib/org-rate-limit.js';
import { requireAuth, requireTenant } from '../../plugins/auth.js';
import { getCurrentVersion, getInstalledWorkflow } from '../workflows/service.js';

/** Per-organization cap on manual triggers: 60/min (plan-based caps post-MVP). */
const EXECUTIONS_PER_ORG_PER_MINUTE = 60;

const executionSummarySchema = z.object({
  id: z.string().uuid(),
  installedWorkflowId: z.string().uuid(),
  status: z.enum([
    'pending',
    'running',
    'waiting',
    'waiting_approval',
    'succeeded',
    'failed',
    'cancelled',
  ]),
  triggerType: z.enum(['manual', 'webhook', 'schedule']),
  currentNodeId: z.string().nullable(),
  error: z.record(z.unknown()).nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});

const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export interface ExecutionsDeps {
  db: Db;
  logger: Logger;
  queue: JobQueue;
}

export function executionRoutes({ db, logger, queue }: ExecutionsDeps) {
  return async function routes(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();
    const auth = requireAuth(db);
    const orgLimiter = new OrgRateLimiter(EXECUTIONS_PER_ORG_PER_MINUTE, 60_000);

    app.route({
      method: 'POST',
      url: '/workflows/:workflowId/executions',
      preHandler: [auth, requireTenant('member')],
      schema: {
        tags: ['executions'],
        params: z.object({ workflowId: z.string().uuid() }),
        response: {
          201: z.object({ executionId: z.string().uuid() }),
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        orgLimiter.check(tenant.organizationId);
        await assertWithinPlanLimits(db, tenant, 'executions');
        const installed = await getInstalledWorkflow(db, tenant, request.params.workflowId);
        if (installed.status !== 'active') {
          throw new AppError('CONFLICT', 'Workflow is not active');
        }
        const version = await getCurrentVersion(db, tenant, installed.id);

        const [execution] = await db
          .insert(schema.workflowExecutions)
          .values({
            organizationId: tenant.organizationId,
            installedWorkflowId: installed.id,
            workflowVersionId: version.id,
            status: 'pending',
            triggerType: 'manual',
            createdBy: tenant.userId,
          })
          .returning();
        if (!execution) throw new AppError('INTERNAL_ERROR', 'Failed to create execution');

        // The executor (worker, Cycle 6) picks this up; idempotency key
        // guarantees a single job per execution even on retried requests.
        await queue.enqueue(
          'execution.run',
          { organizationId: tenant.organizationId, executionId: execution.id },
          { idempotencyKey: execution.id },
        );
        await writeAudit(db, {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'execution.triggered',
          resourceType: 'workflow_execution',
          resourceId: execution.id,
          metadata: { installedWorkflowId: installed.id },
        });
        await db.insert(schema.usageEvents).values({
          organizationId: tenant.organizationId,
          eventType: 'execution.triggered',
          occurredAt: new Date(),
        });
        logger.info('execution enqueued', {
          organizationId: tenant.organizationId,
          executionId: execution.id,
        });
        return reply.status(201).send({ executionId: execution.id });
      },
    });

    app.route({
      method: 'GET',
      url: '/executions',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['executions'],
        querystring: z.object({
          workflowId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }),
        response: { 200: z.object({ executions: z.array(executionSummarySchema) }) },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const filters = [eq(schema.workflowExecutions.organizationId, tenant.organizationId)];
        if (request.query.workflowId) {
          filters.push(eq(schema.workflowExecutions.installedWorkflowId, request.query.workflowId));
        }
        const rows = await db
          .select()
          .from(schema.workflowExecutions)
          .where(and(...filters))
          .orderBy(desc(schema.workflowExecutions.createdAt))
          .limit(request.query.limit);
        return reply.status(200).send({ executions: rows.map(serializeExecution) });
      },
    });

    app.route({
      method: 'GET',
      url: '/executions/:executionId',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['executions'],
        params: z.object({ executionId: z.string().uuid() }),
        response: {
          200: executionSummarySchema.extend({ context: z.record(z.unknown()) }),
          404: errorResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const execution = await loadExecution(
          db,
          tenant.organizationId,
          request.params.executionId,
        );
        return reply.status(200).send({
          ...serializeExecution(execution),
          context: (execution.context ?? {}) as Record<string, unknown>,
        });
      },
    });

    app.route({
      method: 'GET',
      url: '/executions/:executionId/steps',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['executions'],
        params: z.object({ executionId: z.string().uuid() }),
        response: {
          200: z.object({
            steps: z.array(
              z.object({
                id: z.string().uuid(),
                nodeId: z.string(),
                nodeKind: z.string(),
                status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
                attempt: z.number(),
                branch: z.string().nullable(),
                output: z.unknown().nullable(),
                error: z.record(z.unknown()).nullable(),
                startedAt: z.string().nullable(),
                finishedAt: z.string().nullable(),
              }),
            ),
          }),
          404: errorResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        await loadExecution(db, tenant.organizationId, request.params.executionId);
        const steps = await db
          .select()
          .from(schema.workflowExecutionSteps)
          .where(
            and(
              eq(schema.workflowExecutionSteps.organizationId, tenant.organizationId),
              eq(schema.workflowExecutionSteps.workflowExecutionId, request.params.executionId),
            ),
          )
          .orderBy(asc(schema.workflowExecutionSteps.createdAt));
        return reply.status(200).send({
          steps: steps.map((s) => ({
            id: s.id,
            nodeId: s.nodeId,
            nodeKind: s.nodeKind,
            status: s.status as 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped',
            attempt: s.attempt,
            branch: s.branch,
            output: s.output ?? null,
            error: (s.error ?? null) as Record<string, unknown> | null,
            startedAt: s.startedAt?.toISOString() ?? null,
            finishedAt: s.finishedAt?.toISOString() ?? null,
          })),
        });
      },
    });

    app.route({
      method: 'GET',
      url: '/executions/:executionId/logs',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['executions'],
        params: z.object({ executionId: z.string().uuid() }),
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }),
        response: {
          200: z.object({
            logs: z.array(
              z.object({
                id: z.string().uuid(),
                stepId: z.string().uuid().nullable(),
                level: z.enum(['debug', 'info', 'warn', 'error']),
                message: z.string(),
                fields: z.record(z.unknown()).nullable(),
                createdAt: z.string(),
              }),
            ),
          }),
          404: errorResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        await loadExecution(db, tenant.organizationId, request.params.executionId);
        const logs = await db
          .select()
          .from(schema.workflowExecutionLogs)
          .where(
            and(
              eq(schema.workflowExecutionLogs.organizationId, tenant.organizationId),
              eq(schema.workflowExecutionLogs.workflowExecutionId, request.params.executionId),
            ),
          )
          .orderBy(asc(schema.workflowExecutionLogs.createdAt))
          .limit(request.query.limit);
        return reply.status(200).send({
          logs: logs.map((l) => ({
            id: l.id,
            stepId: l.stepId,
            level: l.level as 'debug' | 'info' | 'warn' | 'error',
            message: l.message,
            fields: (l.fields ?? null) as Record<string, unknown> | null,
            createdAt: l.createdAt.toISOString(),
          })),
        });
      },
    });
  };
}

async function loadExecution(db: Db, organizationId: string, executionId: string) {
  const [execution] = await db
    .select()
    .from(schema.workflowExecutions)
    .where(
      and(
        eq(schema.workflowExecutions.id, executionId),
        eq(schema.workflowExecutions.organizationId, organizationId),
      ),
    );
  if (!execution) throw new AppError('NOT_FOUND', 'Execution not found');
  return execution;
}

type ExecutionRow = typeof schema.workflowExecutions.$inferSelect;

function serializeExecution(e: ExecutionRow) {
  return {
    id: e.id,
    installedWorkflowId: e.installedWorkflowId,
    status: e.status as z.infer<typeof executionSummarySchema>['status'],
    triggerType: e.triggerType as 'manual' | 'webhook' | 'schedule',
    currentNodeId: e.currentNodeId,
    error: (e.error ?? null) as Record<string, unknown> | null,
    startedAt: e.startedAt?.toISOString() ?? null,
    finishedAt: e.finishedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}
