import { createHash, randomBytes } from 'node:crypto';

import type { Db } from '@flowhub/database';
import { schema } from '@flowhub/database';
import { AppError, type OrganizationId, type TenantContext, type UserId } from '@flowhub/shared';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const SESSION_COOKIE = 'flowhub_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
/** Sliding expiration: extend at most when less than 6 days remain. */
const SESSION_EXTEND_THRESHOLD_MS = 6 * 24 * 3600 * 1000;

export interface AuthenticatedUser {
  id: UserId;
  email: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    sessionId?: string;
    tenant?: TenantContext;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  db: Db,
  userId: string,
  activeOrganizationId: string | null,
): Promise<CreatedSession> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({
    userId,
    tokenHash: hashToken(token),
    activeOrganizationId,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.sessions.id, sessionId));
}

export function setSessionCookie(
  reply: FastifyReply,
  session: CreatedSession,
  isProduction: boolean,
): void {
  void reply.setCookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    signed: true,
    path: '/',
    expires: session.expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

interface ResolvedSession {
  sessionId: string;
  user: AuthenticatedUser;
  activeOrganizationId: string | null;
  expiresAt: Date;
}

/** Resolves and slides the session from the signed cookie. Null = not authenticated. */
export async function resolveSession(
  db: Db,
  request: FastifyRequest,
): Promise<ResolvedSession | null> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;

  const now = new Date();
  const [row] = await db
    .select({
      sessionId: schema.sessions.id,
      activeOrganizationId: schema.sessions.activeOrganizationId,
      expiresAt: schema.sessions.expiresAt,
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      userStatus: schema.users.status,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.sessions.tokenHash, hashToken(unsigned.value)),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, now),
        isNull(schema.users.deletedAt),
      ),
    );
  if (!row || row.userStatus !== 'active') return null;

  if (row.expiresAt.getTime() - now.getTime() < SESSION_EXTEND_THRESHOLD_MS) {
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(schema.sessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    user: { id: row.userId as UserId, email: row.email, name: row.name },
    activeOrganizationId: row.activeOrganizationId,
    expiresAt: row.expiresAt,
  };
}

/** preHandler: requires a valid session; attaches request.user. */
export function requireAuth(db: Db) {
  return async (request: FastifyRequest): Promise<void> => {
    const session = await resolveSession(db, request);
    if (!session) throw new AppError('UNAUTHORIZED', 'Authentication required');
    request.user = session.user;
    request.sessionId = session.sessionId;
    if (session.activeOrganizationId) {
      // Membership is re-validated on every request — a revoked member must
      // lose access immediately even with a live session (SECURITY_MODEL §4).
      const [membership] = await db
        .select({ role: schema.organizationMembers.role })
        .from(schema.organizationMembers)
        .where(
          and(
            eq(schema.organizationMembers.organizationId, session.activeOrganizationId),
            eq(schema.organizationMembers.userId, session.user.id),
          ),
        );
      if (membership) {
        request.tenant = {
          organizationId: session.activeOrganizationId as OrganizationId,
          userId: session.user.id,
          role: membership.role as TenantContext['role'],
        };
      }
    }
  };
}

const ROLE_ORDER: Record<TenantContext['role'], number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/**
 * preHandler: requires an active organization with at least `minRole`.
 * Compose after requireAuth. Fail-closed: no tenant → FORBIDDEN.
 */
export function requireTenant(minRole: TenantContext['role']) {
  return async (request: FastifyRequest): Promise<void> => {
    const tenant = request.tenant;
    if (!tenant) {
      throw new AppError('FORBIDDEN', 'An active organization is required');
    }
    if (ROLE_ORDER[tenant.role] < ROLE_ORDER[minRole]) {
      throw new AppError('FORBIDDEN', `Requires ${minRole} role`);
    }
  };
}
