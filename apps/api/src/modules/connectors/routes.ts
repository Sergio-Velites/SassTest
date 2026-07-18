import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { DbSecretsStore, OAuthProviderConfig } from '@flowhub/connectors';
import {
  buildAuthorizationUrl,
  createMockConnectorRegistry,
  emailCredentialsSchema,
  exchangeAuthorizationCode,
  generatePkcePair,
  holdedCredentialsSchema,
} from '@flowhub/connectors';
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

const OAUTH_STATE_COOKIE = 'flowhub_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

/** OAuth client credentials + provider config for one connectable provider. */
export interface RealConnectorConfig {
  provider: OAuthProviderConfig;
  clientId: string;
  clientSecret: string;
}

export interface ConnectorsDeps {
  db: Db;
  logger: Logger;
  secrets: DbSecretsStore | null;
  /** Providers with credentials configured (slug → config). */
  oauthProviders: Map<string, RealConnectorConfig>;
  apiPublicUrl: string;
  webUrl: string;
  /** Used to sign the state cookie. */
  stateSecret: string;
}

interface OAuthStatePayload {
  state: string;
  verifier: string;
  slug: string;
  organizationId: string;
  userId: string;
  expiresAt: number;
}

function signState(payload: OAuthStatePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyState(token: string, secret: string): OAuthStatePayload | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as OAuthStatePayload;
  if (payload.expiresAt < Date.now()) return null;
  return payload;
}

export function connectorRoutes(deps: ConnectorsDeps) {
  return async function routes(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();
    const auth = requireAuth(deps.db);
    const mocks = createMockConnectorRegistry();

    app.route({
      method: 'GET',
      url: '/connectors',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['connectors'],
        response: {
          200: z.object({
            connectors: z.array(
              z.object({
                slug: z.string(),
                displayName: z.string(),
                auth: z.enum(['none', 'api_key', 'oauth2']),
                /** False when the operator has not configured credentials. */
                available: z.boolean(),
                kind: z.enum(['mock', 'real']),
              }),
            ),
          }),
        },
      },
      handler: async (_request, reply) => {
        const mockEntries = [...mocks.values()].map((c) => ({
          slug: c.slug,
          displayName: c.displayName,
          auth: c.auth,
          available: true,
          kind: 'mock' as const,
        }));
        const realEntries = [
          { slug: 'slack', displayName: 'Slack', auth: 'oauth2' as const, oauth: true },
          {
            slug: 'google',
            displayName: 'Google (Gmail/Drive)',
            auth: 'oauth2' as const,
            oauth: true,
          },
          {
            slug: 'email',
            displayName: 'Email (SMTP/IMAP)',
            auth: 'api_key' as const,
            oauth: false,
          },
          {
            slug: 'holded',
            displayName: 'Holded (contabilidad)',
            auth: 'api_key' as const,
            oauth: false,
          },
        ].map((c) => ({
          slug: c.slug,
          displayName: c.displayName,
          auth: c.auth,
          available: deps.secrets !== null && (!c.oauth || deps.oauthProviders.has(c.slug)),
          kind: 'real' as const,
        }));
        return reply.status(200).send({ connectors: [...mockEntries, ...realEntries] });
      },
    });

    app.route({
      method: 'POST',
      url: '/connector-accounts/:slug/authorize',
      preHandler: [auth, requireTenant('admin')],
      schema: {
        tags: ['connectors'],
        params: z.object({ slug: z.string().min(1).max(40) }),
        response: {
          200: z.object({ authorizationUrl: z.string() }),
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const config = deps.oauthProviders.get(request.params.slug);
        if (!config) throw new AppError('NOT_FOUND', 'Connector not found or not configured');
        if (!deps.secrets) {
          throw new AppError('CONFLICT', 'CONNECTOR_SECRETS_KEY is not configured on the server');
        }

        const { verifier, challenge } = generatePkcePair();
        const state = randomBytes(24).toString('base64url');
        const signed = signState(
          {
            state,
            verifier,
            slug: config.provider.slug,
            organizationId: tenant.organizationId,
            userId: tenant.userId,
            expiresAt: Date.now() + STATE_TTL_MS,
          },
          deps.stateSecret,
        );
        void reply.setCookie(OAUTH_STATE_COOKIE, signed, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/connector-accounts',
          maxAge: STATE_TTL_MS / 1000,
        });
        const authorizationUrl = buildAuthorizationUrl({
          provider: config.provider,
          clientId: config.clientId,
          redirectUri: `${deps.apiPublicUrl}/connector-accounts/callback`,
          state,
          codeChallenge: challenge,
        });
        return reply.status(200).send({ authorizationUrl });
      },
    });

    app.route({
      method: 'GET',
      url: '/connector-accounts/callback',
      schema: {
        tags: ['connectors'],
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      },
      handler: async (request, reply) => {
        const fail = (reason: string) =>
          reply.redirect(`${deps.webUrl}/connectors?error=${encodeURIComponent(reason)}`);

        if (request.query.error) return fail(request.query.error);
        const raw = request.cookies[OAUTH_STATE_COOKIE];
        void reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/connector-accounts' });
        if (!raw || !request.query.code || !request.query.state) return fail('missing_state');
        const payload = verifyState(raw, deps.stateSecret);
        if (!payload || payload.state !== request.query.state) return fail('invalid_state');
        const config = deps.oauthProviders.get(payload.slug);
        if (!config || !deps.secrets) return fail('provider_unavailable');

        try {
          const tokens = await exchangeAuthorizationCode({
            provider: config.provider,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            redirectUri: `${deps.apiPublicUrl}/connector-accounts/callback`,
            code: request.query.code,
            codeVerifier: payload.verifier,
          });
          const secretRef = await deps.secrets.store(payload.organizationId, {
            kind: 'oauth_tokens',
            accessToken: tokens.accessToken,
            ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
            ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
            ...(tokens.extra ? { extra: tokens.extra } : {}),
          });
          const [account] = await deps.db
            .insert(schema.connectorAccounts)
            .values({
              organizationId: payload.organizationId,
              connectorSlug: payload.slug,
              name: tokens.extra?.['teamName'] ?? payload.slug,
              authType: 'oauth2',
              status: 'active',
              createdBy: payload.userId,
            })
            .returning();
          if (!account) return fail('persist_failed');
          await deps.db.insert(schema.connectorSecretsMetadata).values({
            organizationId: payload.organizationId,
            connectorAccountId: account.id,
            secretRef,
            kind: 'oauth_tokens',
          });
          await writeAudit(deps.db, {
            organizationId: payload.organizationId,
            actorUserId: payload.userId,
            action: 'connector.connected',
            resourceType: 'connector_account',
            resourceId: account.id,
            metadata: { slug: payload.slug },
          });
          deps.logger.info('connector connected', {
            organizationId: payload.organizationId,
            slug: payload.slug,
          });
          return reply.redirect(`${deps.webUrl}/connectors?connected=${payload.slug}`);
        } catch (error) {
          deps.logger.error('oauth callback failed', { error: (error as Error).message });
          return fail('exchange_failed');
        }
      },
    });

    /** api_key connectors (email, holded): credentials posted once, stored encrypted. */
    const API_KEY_CONNECTORS: Record<string, { schema: z.ZodTypeAny; kind: 'api_key' }> = {
      email: { schema: emailCredentialsSchema, kind: 'api_key' },
      holded: { schema: holdedCredentialsSchema, kind: 'api_key' },
    };

    app.route({
      method: 'POST',
      url: '/connector-accounts/:slug/connect',
      preHandler: [auth, requireTenant('admin')],
      schema: {
        tags: ['connectors'],
        params: z.object({ slug: z.string().min(1).max(40) }),
        body: z.object({
          name: z.string().min(1).max(200),
          credentials: z.record(z.string()),
        }),
        response: {
          201: z.object({ accountId: z.string().uuid() }),
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const definition = API_KEY_CONNECTORS[request.params.slug];
        if (!definition) throw new AppError('NOT_FOUND', 'Connector not found');
        if (!deps.secrets) {
          throw new AppError('CONFLICT', 'CONNECTOR_SECRETS_KEY is not configured on the server');
        }
        const parsed = definition.schema.safeParse(request.body.credentials);
        if (!parsed.success) {
          const detail = parsed.error.issues
            .map((i: z.ZodIssue) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
          throw new AppError('VALIDATION_ERROR', `Invalid credentials — ${detail}`);
        }
        const credentials = parsed.data as Record<string, string>;
        const secretRef = await deps.secrets.store(tenant.organizationId, {
          kind: 'api_key',
          ...(credentials['apiKey'] ? { apiKey: credentials['apiKey'] } : {}),
          extra: credentials,
        });
        const [account] = await deps.db
          .insert(schema.connectorAccounts)
          .values({
            organizationId: tenant.organizationId,
            connectorSlug: request.params.slug,
            name: request.body.name,
            authType: 'api_key',
            status: 'active',
            createdBy: tenant.userId,
          })
          .returning();
        if (!account) throw new AppError('INTERNAL_ERROR', 'Failed to create connector account');
        await deps.db.insert(schema.connectorSecretsMetadata).values({
          organizationId: tenant.organizationId,
          connectorAccountId: account.id,
          secretRef,
          kind: 'api_key',
        });
        await writeAudit(deps.db, {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'connector.connected',
          resourceType: 'connector_account',
          resourceId: account.id,
          metadata: { slug: request.params.slug, method: 'api_key' },
        });
        return reply.status(201).send({ accountId: account.id });
      },
    });

    app.route({
      method: 'GET',
      url: '/connector-accounts',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['connectors'],
        response: {
          200: z.object({
            accounts: z.array(
              z.object({
                id: z.string().uuid(),
                connectorSlug: z.string(),
                name: z.string(),
                authType: z.enum(['none', 'api_key', 'oauth2']),
                status: z.enum(['active', 'revoked', 'error']),
                createdAt: z.string(),
              }),
            ),
          }),
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const rows = await deps.db
          .select()
          .from(schema.connectorAccounts)
          .where(
            and(
              eq(schema.connectorAccounts.organizationId, tenant.organizationId),
              isNull(schema.connectorAccounts.deletedAt),
            ),
          );
        return reply.status(200).send({
          accounts: rows.map((a) => ({
            id: a.id,
            connectorSlug: a.connectorSlug,
            name: a.name,
            authType: a.authType as 'none' | 'api_key' | 'oauth2',
            status: a.status as 'active' | 'revoked' | 'error',
            createdAt: a.createdAt.toISOString(),
          })),
        });
      },
    });

    app.route({
      method: 'POST',
      url: '/connector-accounts/:accountId/revoke',
      preHandler: [auth, requireTenant('admin')],
      schema: {
        tags: ['connectors'],
        params: z.object({ accountId: z.string().uuid() }),
        response: { 200: z.object({ revoked: z.boolean() }), 404: errorResponseSchema },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const [account] = await deps.db
          .select()
          .from(schema.connectorAccounts)
          .where(
            and(
              eq(schema.connectorAccounts.id, request.params.accountId),
              eq(schema.connectorAccounts.organizationId, tenant.organizationId),
            ),
          );
        if (!account) throw new AppError('NOT_FOUND', 'Connector account not found');

        // Delete the stored credentials, then mark the account revoked.
        const metadata = await deps.db
          .select()
          .from(schema.connectorSecretsMetadata)
          .where(
            and(
              eq(schema.connectorSecretsMetadata.connectorAccountId, account.id),
              eq(schema.connectorSecretsMetadata.organizationId, tenant.organizationId),
            ),
          );
        for (const row of metadata) {
          await deps.secrets?.delete(tenant.organizationId, row.secretRef);
          await deps.db
            .delete(schema.connectorSecretsMetadata)
            .where(eq(schema.connectorSecretsMetadata.id, row.id));
        }
        await deps.db
          .update(schema.connectorAccounts)
          .set({ status: 'revoked' })
          .where(eq(schema.connectorAccounts.id, account.id));
        await writeAudit(deps.db, {
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'connector.revoked',
          resourceType: 'connector_account',
          resourceId: account.id,
        });
        return reply.status(200).send({ revoked: true });
      },
    });
  };
}
