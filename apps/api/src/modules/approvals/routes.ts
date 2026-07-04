import type { Db } from '@flowhub/database';
import { schema } from '@flowhub/database';
import type { JobQueue } from '@flowhub/jobs';
import type { Logger } from '@flowhub/observability';
import { AppError, type TenantContext } from '@flowhub/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { writeAudit } from '../../lib/audit.js';
import { requireAuth, requireTenant } from '../../plugins/auth.js';

const approvalSchema = z.object({
  id: z.string().uuid(),
  workflowExecutionId: z.string().uuid(),
  nodeId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  payload: z.record(z.unknown()).nullable(),
  requiredRole: z.enum(['owner', 'admin', 'member', 'viewer']),
  assigneeUserId: z.string().uuid().nullable(),
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'cancelled']),
  resolvedBy: z.string().uuid().nullable(),
  resolvedAt: z.string().nullable(),
  resolutionComment: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});

const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const ROLE_ORDER: Record<TenantContext['role'], number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export interface ApprovalsDeps {
  db: Db;
  logger: Logger;
  queue: JobQueue;
}

export function approvalRoutes({ db, logger, queue }: ApprovalsDeps) {
  return async function routes(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();
    const auth = requireAuth(db);

    app.route({
      method: 'GET',
      url: '/approvals',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['approvals'],
        querystring: z.object({
          status: z
            .enum(['pending', 'approved', 'rejected', 'expired', 'cancelled'])
            .default('pending'),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }),
        response: { 200: z.object({ approvals: z.array(approvalSchema) }) },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const rows = await db
          .select()
          .from(schema.approvalRequests)
          .where(
            and(
              eq(schema.approvalRequests.organizationId, tenant.organizationId),
              eq(schema.approvalRequests.status, request.query.status),
            ),
          )
          .orderBy(desc(schema.approvalRequests.createdAt))
          .limit(request.query.limit);
        return reply.status(200).send({ approvals: rows.map(serializeApproval) });
      },
    });

    app.route({
      method: 'POST',
      url: '/approvals/:approvalId/resolve',
      preHandler: [auth, requireTenant('member')],
      schema: {
        tags: ['approvals'],
        params: z.object({ approvalId: z.string().uuid() }),
        body: z.object({
          decision: z.enum(['approved', 'rejected']),
          comment: z.string().max(2000).optional(),
        }),
        response: {
          200: approvalSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const [approval] = await db
          .select()
          .from(schema.approvalRequests)
          .where(
            and(
              eq(schema.approvalRequests.id, request.params.approvalId),
              eq(schema.approvalRequests.organizationId, tenant.organizationId),
            ),
          );
        if (!approval) throw new AppError('NOT_FOUND', 'Approval request not found');
        if (approval.status !== 'pending') {
          throw new AppError('CONFLICT', 'Approval request is already resolved');
        }
        if (approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
          throw new AppError('CONFLICT', 'Approval request has expired');
        }
        // Permission: the assignee may always resolve; otherwise the
        // member's role must meet the node's required role.
        const isAssignee = approval.assigneeUserId === tenant.userId;
        const meetsRole =
          ROLE_ORDER[tenant.role] >= ROLE_ORDER[approval.requiredRole as TenantContext['role']];
        if (!isAssignee && !meetsRole) {
          throw new AppError('FORBIDDEN', `Requires ${approval.requiredRole} role`);
        }

        const [updated] = await db
          .update(schema.approvalRequests)
          .set({
            status: request.body.decision,
            resolvedBy: tenant.userId,
            resolvedAt: new Date(),
            resolutionComment: request.body.comment ?? null,
          })
          .where(
            and(
              eq(schema.approvalRequests.id, approval.id),
              // Guard against concurrent resolution races.
              eq(schema.approvalRequests.status, 'pending'),
            ),
          )
          .returning();
        if (!updated) throw new AppError('CONFLICT', 'Approval request is already resolved');

        await writeAudit(db, {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'approval.resolved',
          resourceType: 'approval_request',
          resourceId: approval.id,
          metadata: { decision: request.body.decision, executionId: approval.workflowExecutionId },
        });
        // Wake the paused execution so the engine continues down the
        // approved/rejected branch (WORKFLOW_ENGINE.md §6).
        await queue.enqueue(
          'execution.run',
          {
            organizationId: tenant.organizationId,
            executionId: approval.workflowExecutionId,
            approvalRequestId: approval.id,
          },
          { idempotencyKey: `resume-${approval.id}` },
        );
        logger.info('approval resolved', {
          organizationId: tenant.organizationId,
          approvalId: approval.id,
          decision: request.body.decision,
        });
        return reply.status(200).send(serializeApproval(updated));
      },
    });
  };
}

type ApprovalRow = typeof schema.approvalRequests.$inferSelect;

function serializeApproval(a: ApprovalRow) {
  return {
    id: a.id,
    workflowExecutionId: a.workflowExecutionId,
    nodeId: a.nodeId,
    title: a.title,
    description: a.description,
    payload: (a.payload ?? null) as Record<string, unknown> | null,
    requiredRole: a.requiredRole as 'owner' | 'admin' | 'member' | 'viewer',
    assigneeUserId: a.assigneeUserId,
    status: a.status as 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled',
    resolvedBy: a.resolvedBy,
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    resolutionComment: a.resolutionComment,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}
