import type { Db } from '@flowhub/database';
import { schema } from '@flowhub/database';
import { AppError } from '@flowhub/shared';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { requireAuth, requireTenant } from '../../plugins/auth.js';

const templateSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  latestVersionId: z.string().uuid().nullable(),
  latestVersion: z.string().nullable(),
});

export interface CatalogDeps {
  db: Db;
}

/**
 * The catalog lists PUBLISHED templates across tenants — this is the one
 * deliberate system-scope read surface (marketplace precursor). Only
 * published rows are ever visible; drafts stay tenant-private.
 */
export function catalogRoutes({ db }: CatalogDeps) {
  return async function routes(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();
    const auth = requireAuth(db);

    app.route({
      method: 'GET',
      url: '/catalog/templates',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['catalog'],
        response: { 200: z.object({ templates: z.array(templateSummarySchema) }) },
      },
      handler: async (_request, reply) => {
        const templates = await db
          .select()
          .from(schema.workflowTemplates)
          .where(
            and(
              eq(schema.workflowTemplates.status, 'published'),
              isNull(schema.workflowTemplates.deletedAt),
            ),
          )
          .orderBy(desc(schema.workflowTemplates.createdAt));

        const result = [];
        for (const template of templates) {
          const [latest] = await db
            .select({
              id: schema.workflowTemplateVersions.id,
              version: schema.workflowTemplateVersions.version,
            })
            .from(schema.workflowTemplateVersions)
            .where(
              and(
                eq(schema.workflowTemplateVersions.workflowTemplateId, template.id),
                isNotNull(schema.workflowTemplateVersions.publishedAt),
              ),
            )
            .orderBy(desc(schema.workflowTemplateVersions.createdAt))
            .limit(1);
          result.push({
            id: template.id,
            name: template.name,
            description: template.description,
            category: template.category,
            latestVersionId: latest?.id ?? null,
            latestVersion: latest?.version ?? null,
          });
        }
        return reply.status(200).send({ templates: result });
      },
    });

    app.route({
      method: 'GET',
      url: '/catalog/templates/:templateId',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['catalog'],
        params: z.object({ templateId: z.string().uuid() }),
        response: {
          200: templateSummarySchema.extend({
            versions: z.array(
              z.object({
                id: z.string().uuid(),
                version: z.string(),
                changelog: z.string().nullable(),
                publishedAt: z.string().nullable(),
              }),
            ),
          }),
        },
      },
      handler: async (request, reply) => {
        const [template] = await db
          .select()
          .from(schema.workflowTemplates)
          .where(
            and(
              eq(schema.workflowTemplates.id, request.params.templateId),
              eq(schema.workflowTemplates.status, 'published'),
              isNull(schema.workflowTemplates.deletedAt),
            ),
          );
        if (!template) throw new AppError('NOT_FOUND', 'Template not found');

        const versions = await db
          .select()
          .from(schema.workflowTemplateVersions)
          .where(
            and(
              eq(schema.workflowTemplateVersions.workflowTemplateId, template.id),
              isNotNull(schema.workflowTemplateVersions.publishedAt),
            ),
          )
          .orderBy(desc(schema.workflowTemplateVersions.createdAt));

        const latest = versions[0] ?? null;
        return reply.status(200).send({
          id: template.id,
          name: template.name,
          description: template.description,
          category: template.category,
          latestVersionId: latest?.id ?? null,
          latestVersion: latest?.version ?? null,
          versions: versions.map((v) => ({
            id: v.id,
            version: v.version,
            changelog: v.changelog,
            publishedAt: v.publishedAt?.toISOString() ?? null,
          })),
        });
      },
    });
  };
}
