import { loadEnv } from '@flowhub/config';
import { createDb, type DbHandle } from '@flowhub/database';
import { createLogger } from '@flowhub/observability';
import { AppError } from '@flowhub/shared';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';

export const databaseUrl = process.env['DATABASE_URL'];
/** API tests need a live database; skip cleanly on machines without one. */
export const skipWithoutDb = databaseUrl
  ? false
  : 'DATABASE_URL not set — skipping API tests that need a live database';

export interface TestApp {
  app: FastifyInstance;
  handle: DbHandle;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    AUTH_SESSION_SECRET: 'test-session-secret-not-for-production',
    ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
  });
  const handle = createDb(databaseUrl as string, { maxConnections: 3 });
  const app = await buildApp({
    env,
    logger: createLogger('error', { app: 'api-test' }),
    db: handle.db,
  });
  // Route raising a typed domain error, to exercise the error handler.
  app.get('/boom', () => {
    throw new AppError('NOT_FOUND', 'workflow not found');
  });
  return {
    app,
    handle,
    close: async () => {
      await app.close();
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
