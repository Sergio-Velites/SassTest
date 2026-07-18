import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Env } from '@flowhub/config';
import { DbSecretsStore, OAUTH_PROVIDERS, SecretCipher } from '@flowhub/connectors';
import { createSecretRowStore, type Db } from '@flowhub/database';
import type { JobQueue } from '@flowhub/jobs';
import type { Logger } from '@flowhub/observability';
import { type AppErrorCode, isAppError } from '@flowhub/shared';
import fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { approvalRoutes } from './modules/approvals/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { catalogRoutes } from './modules/catalog/routes.js';
import { connectorRoutes, type RealConnectorConfig } from './modules/connectors/routes.js';
import { executionRoutes } from './modules/executions/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { organizationRoutes } from './modules/organizations/routes.js';
import { workflowRoutes } from './modules/workflows/routes.js';

/** Stable AppError code → HTTP status mapping (see docs/api/README.md). */
const ERROR_STATUS: Record<AppErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TENANT_MISMATCH: 404, // never reveal cross-tenant existence
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CONNECTOR_ERROR: 502,
  AI_PROVIDER_ERROR: 502,
  EXECUTION_ERROR: 500,
  INTERNAL_ERROR: 500,
};

export interface AppDeps {
  env: Env;
  logger: Logger;
  db: Db;
  queue: JobQueue;
  /** Extra OAuth providers merged over the env-derived ones (tests). */
  extraOAuthProviders?: Map<string, RealConnectorConfig>;
}

/**
 * Builds the Fastify app with all cross-cutting plugins registered.
 * Route modules plug in under src/modules/<domain>/ (Cycle 5).
 * Kept side-effect free (no listen) so tests can use inject().
 */
export async function buildApp({
  env,
  logger,
  db,
  queue,
  extraOAuthProviders,
}: AppDeps): Promise<FastifyInstance> {
  if (!env.AUTH_SESSION_SECRET) {
    throw new Error('AUTH_SESSION_SECRET is required to build the API (see .env.example)');
  }
  const app = fastify({
    // We use @flowhub/observability for logs; fastify's pino stays off.
    logger: false,
    // Trust proxy headers only in production behind Cloud Run's LB.
    trustProxy: env.NODE_ENV === 'production',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    // The API serves JSON only; a strict CSP also covers the Swagger UI page.
    contentSecurityPolicy: env.NODE_ENV === 'production',
  });

  await app.register(cors, {
    origin: env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 300, // generous global per-IP baseline; per-route/tenant limits arrive in Cycle 9
    timeWindow: '1 minute',
  });

  await app.register(cookie, { secret: env.AUTH_SESSION_SECRET });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'FlowHub AI API',
        description: 'Installable enterprise workflows platform with built-in AI',
        version: '0.1.0',
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (isAppError(error)) {
      const status = ERROR_STATUS[error.code];
      if (status >= 500) {
        logger.error('request failed', { code: error.code, path: request.url, ...error.context });
      }
      return reply.status(status).send({ error: { code: error.code, message: error.message } });
    }
    // Fastify validation errors (schema mismatch) → stable VALIDATION_ERROR shape.
    if (error.validation) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
    if (error.statusCode === 429) {
      return reply
        .status(429)
        .send({ error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' } });
    }
    // Unknown errors: log full detail server-side, return a generic message.
    logger.error('unhandled error', {
      path: request.url,
      message: error.message,
      stack: error.stack,
    });
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
  );

  await app.register(healthRoutes);
  await app.register(authRoutes({ db, logger, isProduction: env.NODE_ENV === 'production' }));
  await app.register(organizationRoutes({ db, logger }));
  await app.register(catalogRoutes({ db }));
  await app.register(workflowRoutes({ db, logger }));
  await app.register(executionRoutes({ db, logger, queue }));
  await app.register(approvalRoutes({ db, logger, queue }));

  // Real connector support: secrets store + whichever OAuth apps are configured.
  const secrets = env.CONNECTOR_SECRETS_KEY
    ? new DbSecretsStore(createSecretRowStore(db), new SecretCipher(env.CONNECTOR_SECRETS_KEY))
    : null;
  const oauthProviders = new Map<string, RealConnectorConfig>();
  if (env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET) {
    const slack = OAUTH_PROVIDERS['slack'];
    if (slack) {
      oauthProviders.set('slack', {
        provider: slack,
        clientId: env.SLACK_CLIENT_ID,
        clientSecret: env.SLACK_CLIENT_SECRET,
      });
    }
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    const google = OAUTH_PROVIDERS['google'];
    if (google) {
      oauthProviders.set('google', {
        provider: google,
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      });
    }
  }
  for (const [slug, config] of extraOAuthProviders ?? new Map()) {
    oauthProviders.set(slug, config);
  }
  await app.register(
    connectorRoutes({
      db,
      logger,
      secrets,
      oauthProviders,
      apiPublicUrl: env.API_PUBLIC_URL,
      webUrl: env.WEB_URL,
      stateSecret: env.AUTH_SESSION_SECRET,
    }),
  );

  return app;
}
