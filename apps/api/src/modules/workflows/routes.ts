import type { Db } from '@flowhub/database';
import { schema } from '@flowhub/database';
import type { Logger } from '@flowhub/observability';
import { AppError } from '@flowhub/shared';
import { parseWorkflowDefinition } from '@flowhub/workflow-engine';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ZodError } from 'zod';

import { writeAudit } from '../../lib/audit.js';
import { requireAuth, requireTenant } from '../../plugins/auth.js';
import {
  createInstalledWorkflow,
  createWorkflowVersion,
  getCurrentVersion,
  getInstalledWorkflow,
} from './service.js';

const installedSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(['active', 'paused', 'archived']),
  fromTemplateVersionId: z.string().uuid().nullable(),
  createdAt: z.string(),
});

const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export interface WorkflowsDeps {
  db: Db;
  logger: Logger;
}

export function workflowRoutes({ db, logger }: WorkflowsDeps) {
  return async function routes(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();
    const auth = requireAuth(db);

    app.route({
      method: 'POST',
      url: '/workflows/install',
      preHandler: [auth, requireTenant('admin')],
      schema: {
        tags: ['workflows'],
        body: z.object({
          templateVersionId: z.string().uuid(),
          name: z.string().min(1).max(200).optional(),
        }),
        response: {
          201: z.object({ installedWorkflowId: z.string().uuid() }),
          404: errorResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');

        // Only published versions of published templates are installable.
        const [row] = await db
          .select({
            versionId: schema.workflowTemplateVersions.id,
            definition: schema.workflowTemplateVersions.definition,
            templateName: schema.workflowTemplates.name,
          })
          .from(schema.workflowTemplateVersions)
          .innerJoin(
            schema.workflowTemplates,
            eq(schema.workflowTemplateVersions.workflowTemplateId, schema.workflowTemplates.id),
          )
          .where(
            and(
              eq(schema.workflowTemplateVersions.id, request.body.templateVersionId),
              isNotNull(schema.workflowTemplateVersions.publishedAt),
              eq(schema.workflowTemplates.status, 'published'),
              isNull(schema.workflowTemplates.deletedAt),
            ),
          );
        if (!row) throw new AppError('NOT_FOUND', 'Template version not found');

        // Installation copies the definition — later template changes never
        // mutate what a tenant runs (WORKFLOW_ENGINE.md §9).
        const definition = parseWorkflowDefinition(row.definition);
        const { installedWorkflowId } = await createInstalledWorkflow(db, tenant, {
          name: request.body.name ?? row.templateName,
          definition,
          workflowTemplateVersionId: row.versionId,
        });
        await writeAudit(db, {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'workflow.installed',
          resourceType: 'installed_workflow',
          resourceId: installedWorkflowId,
          metadata: { templateVersionId: row.versionId },
        });
        await db.insert(schema.usageEvents).values({
          organizationId: tenant.organizationId,
          eventType: 'workflow.installed',
          occurredAt: new Date(),
        });
        logger.info('workflow installed', {
          organizationId: tenant.organizationId,
          installedWorkflowId,
        });
        return reply.status(201).send({ installedWorkflowId });
      },
    });

    app.route({
      method: 'POST',
      url: '/workflows',
      preHandler: [auth, requireTenant('admin')],
      schema: {
        tags: ['workflows'],
        body: z.object({
          name: z.string().min(1).max(200),
          /** Raw workflow definition JSON — validated by the engine schema. */
          definition: z.record(z.unknown()),
        }),
        response: {
          201: z.object({ installedWorkflowId: z.string().uuid() }),
          400: errorResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        let definition;
        try {
          definition = parseWorkflowDefinition(request.body.definition);
        } catch (error) {
          const detail =
            error instanceof ZodError
              ? error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
              : 'invalid definition';
          throw new AppError('VALIDATION_ERROR', `Invalid workflow definition — ${detail}`);
        }
        const { installedWorkflowId } = await createInstalledWorkflow(db, tenant, {
          name: request.body.name,
          definition,
        });
        await writeAudit(db, {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'workflow.created_from_json',
          resourceType: 'installed_workflow',
          resourceId: installedWorkflowId,
        });
        return reply.status(201).send({ installedWorkflowId });
      },
    });

    app.route({
      method: 'GET',
      url: '/workflows',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['workflows'],
        response: { 200: z.object({ workflows: z.array(installedSummarySchema) }) },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const rows = await db
          .select()
          .from(schema.installedWorkflows)
          .where(
            and(
              eq(schema.installedWorkflows.organizationId, tenant.organizationId),
              isNull(schema.installedWorkflows.deletedAt),
            ),
          )
          .orderBy(desc(schema.installedWorkflows.createdAt));
        return reply.status(200).send({
          workflows: rows.map((w) => ({
            id: w.id,
            name: w.name,
            status: w.status as 'active' | 'paused' | 'archived',
            fromTemplateVersionId: w.workflowTemplateVersionId,
            createdAt: w.createdAt.toISOString(),
          })),
        });
      },
    });

    app.route({
      method: 'PUT',
      url: '/workflows/:workflowId',
      preHandler: [auth, requireTenant('admin')],
      schema: {
        tags: ['workflows'],
        params: z.object({ workflowId: z.string().uuid() }),
        body: z.object({
          /** Raw workflow definition JSON — validated by the engine schema. */
          definition: z.record(z.unknown()),
        }),
        response: {
          200: z.object({ workflowVersionId: z.string().uuid(), version: z.number() }),
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const installed = await getInstalledWorkflow(db, tenant, request.params.workflowId);
        let definition;
        try {
          definition = parseWorkflowDefinition(request.body.definition);
        } catch (error) {
          const detail =
            error instanceof ZodError
              ? error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
              : 'invalid definition';
          throw new AppError('VALIDATION_ERROR', `Invalid workflow definition — ${detail}`);
        }
        const result = await createWorkflowVersion(db, tenant, installed.id, definition);
        await writeAudit(db, {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'workflow.version_created',
          resourceType: 'installed_workflow',
          resourceId: installed.id,
          metadata: { version: result.version },
        });
        logger.info('workflow version created', {
          organizationId: tenant.organizationId,
          installedWorkflowId: installed.id,
          version: result.version,
        });
        return reply.status(200).send(result);
      },
    });

    app.route({
      method: 'GET',
      url: '/workflows/:workflowId/versions',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['workflows'],
        params: z.object({ workflowId: z.string().uuid() }),
        response: {
          200: z.object({
            versions: z.array(
              z.object({
                id: z.string().uuid(),
                version: z.number(),
                isCurrent: z.boolean(),
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
        const installed = await getInstalledWorkflow(db, tenant, request.params.workflowId);
        const rows = await db
          .select()
          .from(schema.workflowVersions)
          .where(
            and(
              eq(schema.workflowVersions.installedWorkflowId, installed.id),
              eq(schema.workflowVersions.organizationId, tenant.organizationId),
            ),
          )
          .orderBy(desc(schema.workflowVersions.version));
        return reply.status(200).send({
          versions: rows.map((v) => ({
            id: v.id,
            version: v.version,
            isCurrent: v.isCurrent,
            createdAt: v.createdAt.toISOString(),
          })),
        });
      },
    });

    app.route({
      method: 'GET',
      url: '/workflows/:workflowId',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['workflows'],
        params: z.object({ workflowId: z.string().uuid() }),
        response: {
          200: installedSummarySchema.extend({
            currentVersion: z.number(),
            definition: z.record(z.unknown()),
          }),
          404: errorResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const installed = await getInstalledWorkflow(db, tenant, request.params.workflowId);
        const current = await getCurrentVersion(db, tenant, installed.id);
        return reply.status(200).send({
          id: installed.id,
          name: installed.name,
          status: installed.status as 'active' | 'paused' | 'archived',
          fromTemplateVersionId: installed.workflowTemplateVersionId,
          createdAt: installed.createdAt.toISOString(),
          currentVersion: current.version,
          definition: current.definition as unknown as Record<string, unknown>,
        });
      },
    });
  };
}
