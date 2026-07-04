import { createHash, randomBytes } from 'node:crypto';

import type { Db } from '@flowhub/database';
import { schema } from '@flowhub/database';
import type { Logger } from '@flowhub/observability';
import { AppError } from '@flowhub/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { writeAudit } from '../../lib/audit.js';
import { requireAuth, requireTenant } from '../../plugins/auth.js';

const roleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);

const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  plan: z.string(),
});

const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;

export interface OrganizationsDeps {
  db: Db;
  logger: Logger;
}

export function organizationRoutes({ db, logger }: OrganizationsDeps) {
  return async function routes(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();
    const auth = requireAuth(db);

    app.route({
      method: 'POST',
      url: '/organizations',
      preHandler: [auth],
      schema: {
        tags: ['organizations'],
        body: z.object({
          name: z.string().min(1).max(200),
          slug: z
            .string()
            .min(2)
            .max(63)
            .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'lowercase letters, digits and dashes'),
        }),
        response: { 201: organizationSchema, 409: errorResponseSchema },
      },
      handler: async (request, reply) => {
        const user = request.user;
        if (!user || !request.sessionId)
          throw new AppError('UNAUTHORIZED', 'Authentication required');
        const { name, slug } = request.body;

        const [existing] = await db
          .select({ id: schema.organizations.id })
          .from(schema.organizations)
          .where(eq(schema.organizations.slug, slug));
        if (existing) throw new AppError('CONFLICT', 'This slug is already taken');

        const [org] = await db
          .insert(schema.organizations)
          .values({ name, slug, plan: 'free', createdBy: user.id })
          .returning();
        if (!org) throw new AppError('INTERNAL_ERROR', 'Failed to create organization');

        await db
          .insert(schema.organizationMembers)
          .values({ organizationId: org.id, userId: user.id, role: 'owner' });
        await db
          .insert(schema.subscriptions)
          .values({ organizationId: org.id, planSlug: 'free', status: 'active' })
          .onConflictDoNothing();
        // The new organization becomes the session's active tenant.
        await db
          .update(schema.sessions)
          .set({ activeOrganizationId: org.id })
          .where(eq(schema.sessions.id, request.sessionId));
        await writeAudit(db, {
          organizationId: org.id,
          actorUserId: user.id,
          action: 'organization.created',
          resourceType: 'organization',
          resourceId: org.id,
        });
        logger.info('organization created', { organizationId: org.id, userId: user.id });
        return reply
          .status(201)
          .send({ id: org.id, name: org.name, slug: org.slug, plan: org.plan });
      },
    });

    app.route({
      method: 'GET',
      url: '/organizations/current',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['organizations'],
        response: { 200: organizationSchema, 403: errorResponseSchema },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const [org] = await db
          .select()
          .from(schema.organizations)
          .where(
            and(
              eq(schema.organizations.id, tenant.organizationId),
              isNull(schema.organizations.deletedAt),
            ),
          );
        if (!org) throw new AppError('NOT_FOUND', 'Organization not found');
        return reply
          .status(200)
          .send({ id: org.id, name: org.name, slug: org.slug, plan: org.plan });
      },
    });

    app.route({
      method: 'GET',
      url: '/organizations/current/members',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['organizations'],
        response: {
          200: z.object({
            members: z.array(
              z.object({
                userId: z.string().uuid(),
                name: z.string(),
                email: z.string(),
                role: roleSchema,
              }),
            ),
          }),
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const rows = await db
          .select({
            userId: schema.organizationMembers.userId,
            name: schema.users.name,
            email: schema.users.email,
            role: schema.organizationMembers.role,
          })
          .from(schema.organizationMembers)
          .innerJoin(schema.users, eq(schema.organizationMembers.userId, schema.users.id))
          .where(eq(schema.organizationMembers.organizationId, tenant.organizationId));
        return reply.status(200).send({
          members: rows.map((r) => ({ ...r, role: r.role as z.infer<typeof roleSchema> })),
        });
      },
    });

    app.route({
      method: 'POST',
      url: '/organizations/current/invitations',
      preHandler: [auth, requireTenant('admin')],
      schema: {
        tags: ['organizations'],
        body: z.object({
          email: z.string().email().max(320),
          role: roleSchema.exclude(['owner']),
        }),
        response: {
          201: z.object({
            invitationId: z.string().uuid(),
            /**
             * MVP: the invite token is returned once to the caller (no email
             * sending yet). Post-MVP this moves to an email delivery.
             */
            token: z.string(),
            expiresAt: z.string(),
          }),
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const { email, role } = request.body;
        const token = randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
        const [invitation] = await db
          .insert(schema.invitations)
          .values({
            organizationId: tenant.organizationId,
            email,
            role,
            tokenHash: createHash('sha256').update(token).digest('hex'),
            expiresAt,
            createdBy: tenant.userId,
          })
          .returning();
        if (!invitation) throw new AppError('INTERNAL_ERROR', 'Failed to create invitation');
        await writeAudit(db, {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'member.invited',
          resourceType: 'invitation',
          resourceId: invitation.id,
          metadata: { role },
        });
        return reply
          .status(201)
          .send({ invitationId: invitation.id, token, expiresAt: expiresAt.toISOString() });
      },
    });

    app.route({
      method: 'POST',
      url: '/invitations/accept',
      preHandler: [auth],
      schema: {
        tags: ['organizations'],
        body: z.object({ token: z.string().min(32).max(128) }),
        response: {
          200: z.object({ organizationId: z.string().uuid(), role: roleSchema }),
          404: errorResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const user = request.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'Authentication required');
        const tokenHash = createHash('sha256').update(request.body.token).digest('hex');
        const [invitation] = await db
          .select()
          .from(schema.invitations)
          .where(eq(schema.invitations.tokenHash, tokenHash));
        if (
          !invitation ||
          invitation.acceptedAt ||
          invitation.revokedAt ||
          invitation.expiresAt.getTime() < Date.now()
        ) {
          throw new AppError('NOT_FOUND', 'Invitation not found or no longer valid');
        }
        await db
          .insert(schema.organizationMembers)
          .values({
            organizationId: invitation.organizationId,
            userId: user.id,
            role: invitation.role,
          })
          .onConflictDoNothing();
        await db
          .update(schema.invitations)
          .set({ acceptedAt: new Date() })
          .where(eq(schema.invitations.id, invitation.id));
        await writeAudit(db, {
          organizationId: invitation.organizationId,
          actorUserId: user.id,
          action: 'member.joined',
          resourceType: 'organization',
          resourceId: invitation.organizationId,
          metadata: { role: invitation.role },
        });
        return reply.status(200).send({
          organizationId: invitation.organizationId,
          role: invitation.role as z.infer<typeof roleSchema>,
        });
      },
    });
  };
}
