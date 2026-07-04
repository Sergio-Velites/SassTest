import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadEnv } from '@flowhub/config';
import { createLogger } from '@flowhub/observability';
import { AppError } from '@flowhub/shared';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';

async function testApp(): Promise<FastifyInstance> {
  const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });
  const app = await buildApp({ env, logger: createLogger('error', { app: 'api-test' }) });
  // Route that raises a typed domain error, to exercise the error handler.
  app.get('/boom', () => {
    throw new AppError('NOT_FOUND', 'workflow not found');
  });
  return app;
}

test('GET /health returns ok with schema-validated body', async () => {
  const app = await testApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, 'ok');
  assert.equal(typeof body.uptimeSeconds, 'number');
  await app.close();
});

test('security headers are present', async () => {
  const app = await testApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
  await app.close();
});

test('AppError maps to stable HTTP status and error shape', async () => {
  const app = await testApp();
  const res = await app.inject({ method: 'GET', url: '/boom' });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), {
    error: { code: 'NOT_FOUND', message: 'workflow not found' },
  });
  await app.close();
});

test('unknown routes return stable NOT_FOUND shape', async () => {
  const app = await testApp();
  const res = await app.inject({ method: 'GET', url: '/nope' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'NOT_FOUND');
  await app.close();
});

test('OpenAPI docs are exposed', async () => {
  const app = await testApp();
  const res = await app.inject({ method: 'GET', url: '/docs' });
  assert.ok([200, 302].includes(res.statusCode));
  await app.close();
});
