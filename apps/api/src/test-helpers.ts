import { loadEnv } from '@flowhub/config';
import { createDb, type DbHandle } from '@flowhub/database';
import { InMemoryJobQueue } from '@flowhub/jobs';
import { createLogger } from '@flowhub/observability';
import { AppError } from '@flowhub/shared';
import type { FastifyInstance } from 'fastify';

import { buildApp, type AppDeps } from './app.js';

export const databaseUrl = process.env['DATABASE_URL'];
/** API tests need a live database; skip cleanly on machines without one. */
export const skipWithoutDb = databaseUrl
  ? false
  : 'DATABASE_URL not set — skipping API tests that need a live database';

export interface TestApp {
  app: FastifyInstance;
  handle: DbHandle;
  /** Inspectable in-memory queue — tests can assert what was enqueued. */
  queue: InMemoryJobQueue;
  close(): Promise<void>;
}

export async function createTestApp(
  options?: Pick<AppDeps, 'extraOAuthProviders'>,
): Promise<TestApp> {
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    AUTH_SESSION_SECRET: 'test-session-secret-not-for-production',
    CONNECTOR_SECRETS_KEY: 'f'.repeat(64),
    ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
  });
  const handle = createDb(databaseUrl as string, { maxConnections: 3 });
  const queue = new InMemoryJobQueue();
  const app = await buildApp({
    env,
    logger: createLogger('error', { app: 'api-test' }),
    db: handle.db,
    queue,
    ...(options?.extraOAuthProviders ? { extraOAuthProviders: options.extraOAuthProviders } : {}),
  });
  // Route raising a typed domain error, to exercise the error handler.
  app.get('/boom', () => {
    throw new AppError('NOT_FOUND', 'workflow not found');
  });
  return {
    app,
    handle,
    queue,
    close: async () => {
      await app.close();
      await queue.close();
      await handle.close();
    },
  };
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}

/** Extracts the session cookie header value from a register/login response. */
export function sessionCookieOf(res: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = res.cookies.find((c) => c.name === 'flowhub_session');
  if (!cookie) throw new Error('no session cookie in response');
  return `flowhub_session=${encodeURIComponent(cookie.value)}`;
}
