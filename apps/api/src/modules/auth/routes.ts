import type { Db } from '@flowhub/database';
import { schema } from '@flowhub/database';
import type { Logger } from '@flowhub/observability';
import { AppError } from '@flowhub/shared';
import argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { writeAudit } from '../../lib/audit.js';
import {
  clearSessionCookie,
  createSession,
  requireAuth,
  resolveSession,
  revokeSession,
  setSessionCookie,
} from '../../plugins/auth.js';

const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
});

const registerSchema = credentialsSchema.extend({
  name: z.string().min(1).max(200),
});

const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
});

const meResponseSchema = z.object({
  user: userResponseSchema,
  activeOrganizationId: z.string().uuid().nullable(),
  memberships: z.array(
    z.object({
      organizationId: z.string().uuid(),
      organizationName: z.string(),
      organizationSlug: z.string(),
      role: z.enum(['owner', 'admin', 'member', 'viewer']),
    }),
  ),
});

const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export interface AuthRoutesDeps {
  db: Db;
  logger: Logger;
  isProduction: boolean;
}

/** Brute-force protection: tighter per-IP limits on all auth endpoints. */
const AUTH_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export function authRoutes({ db, logger, isProduction }: AuthRoutesDeps) {
  return async function routes(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.route({
      method: 'POST',
      url: '/auth/register',
      config: AUTH_RATE_LIMIT,
      schema: {
        tags: ['auth'],
        body: registerSchema,
        response: { 201: meResponseSchema, 409: errorResponseSchema },
      },
      handler: async (request, reply) => {
        const { email, password, name } = request.body;
        const [existing] = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, email));
        if (existing) {
          throw new AppError('CONFLICT', 'An account with this email already exists');
        }
        const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
        const [user] = await db
          .insert(schema.users)
          .values({ email, name, passwordHash })
          .returning();
        if (!user) throw new AppError('INTERNAL_ERROR', 'Failed to create user');

        const session = await createSession(db, user.id, null);
        setSessionCookie(reply, session, isProduction);
        logger.info('user registered', { userId: user.id });
        return reply.status(201).send({
          user: { id: user.id, email: user.email, name: user.name },
          activeOrganizationId: null,
          memberships: [],
        });
      },
    });

    app.route({
      method: 'POST',
      url: '/auth/login',
      config: AUTH_RATE_LIMIT,
      schema: {
        tags: ['auth'],
        body: credentialsSchema,
        response: { 200: meResponseSchema, 401: errorResponseSchema },
      },
      handler: async (request, reply) => {
        const { email, password } = request.body;
        const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
        // Same error for unknown email and wrong password — no account probing.
        const invalid = new AppError('UNAUTHORIZED', 'Invalid email or password');
        if (!user || !user.passwordHash || user.status !== 'active' || user.deletedAt) {
          throw invalid;
        }
        const ok = await argon2.verify(user.passwordHash, password);
        if (!ok) throw invalid;

        const memberships = await listMemberships(db, user.id);
        const active = memberships[0]?.organizationId ?? null;
        const session = await createSession(db, user.id, active);
        setSessionCookie(reply, session, isProduction);
        logger.info('user logged in', { userId: user.id });
        return reply.status(200).send({
          user: { id: user.id, email: user.email, name: user.name },
          activeOrganizationId: active,
          memberships,
        });
      },
    });

    app.route({
      method: 'POST',
      url: '/auth/logout',
      config: AUTH_RATE_LIMIT,
      preHandler: [requireAuth(db)],
      schema: { tags: ['auth'], response: { 204: z.null() } },
      handler: async (request, reply) => {
        if (request.sessionId) await revokeSession(db, request.sessionId);
        clearSessionCookie(reply);
        return reply.status(204).send(null);
      },
    });

    app.route({
      method: 'GET',
      url: '/auth/me',
      preHandler: [requireAuth(db)],
      schema: {
        tags: ['auth'],
        response: { 200: meResponseSchema, 401: errorResponseSchema },
      },
      handler: async (request, reply) => {
        const user = request.user;
        if (!user) throw new AppError('UNAUTHORIZED', 'Authentication required');
        const session = await resolveSession(db, request);
        const memberships = await listMemberships(db, user.id);
        return reply.status(200).send({
          user,
          activeOrganizationId: session?.activeOrganizationId ?? null,
          memberships,
        });
      },
    });

    app.route({
      method: 'POST',
      url: '/auth/switch-organization',
      config: AUTH_RATE_LIMIT,
      preHandler: [requireAuth(db)],
      schema: {
        tags: ['auth'],
        body: z.object({ organizationId: z.string().uuid() }),
        response: { 200: meResponseSchema, 404: errorResponseSchema },
      },
      handler: async (request, reply) => {
        const user = request.user;
        if (!user || !request.sessionId) {
          throw new AppError('UNAUTHORIZED', 'Authentication required');
        }
        const { organizationId } = request.body;
        const [membership] = await db
          .select({ role: schema.organizationMembers.role })
          .from(schema.organizationMembers)
          .where(
            and(
              eq(schema.organizationMembers.organizationId, organizationId),
              eq(schema.organizationMembers.userId, user.id),
            ),
          );
        // NOT_FOUND (not FORBIDDEN): don't leak other tenants' existence.
        if (!membership) throw new AppError('NOT_FOUND', 'Organization not found');

        await db
          .update(schema.sessions)
          .set({ activeOrganizationId: organizationId })
          .where(eq(schema.sessions.id, request.sessionId));
        await writeAudit(db, {
          organizationId,
          actorUserId: user.id,
          action: 'session.organization_switched',
          resourceType: 'organization',
          resourceId: organizationId,
        });
        const memberships = await listMemberships(db, user.id);
        return reply.status(200).send({
          user,
          activeOrganizationId: organizationId,
          memberships,
        });
      },
    });
  };
}

async function listMemberships(db: Db, userId: string) {
  const rows = await db
    .select({
      organizationId: schema.organizationMembers.organizationId,
      organizationName: schema.organizations.name,
      organizationSlug: schema.organizations.slug,
      role: schema.organizationMembers.role,
    })
    .from(schema.organizationMembers)
    .innerJoin(
      schema.organizations,
      eq(schema.organizationMembers.organizationId, schema.organizations.id),
    )
    .where(eq(schema.organizationMembers.userId, userId));
  return rows.map((r) => ({ ...r, role: r.role as 'owner' | 'admin' | 'member' | 'viewer' }));
}
