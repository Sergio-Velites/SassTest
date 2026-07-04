import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTestApp, skipWithoutDb } from './test-helpers.js';

test('GET /health returns ok with schema-validated body', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  const res = await t.app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, 'ok');
  assert.equal(typeof body.uptimeSeconds, 'number');
  await t.close();
});

test('security headers are present', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  const res = await t.app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
  await t.close();
});

test('AppError maps to stable HTTP status and error shape', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  const res = await t.app.inject({ method: 'GET', url: '/boom' });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), {
    error: { code: 'NOT_FOUND', message: 'workflow not found' },
  });
  await t.close();
});

test('unknown routes return stable NOT_FOUND shape', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  const res = await t.app.inject({ method: 'GET', url: '/nope' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'NOT_FOUND');
  await t.close();
});

test('OpenAPI docs are exposed', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  const res = await t.app.inject({ method: 'GET', url: '/docs' });
  assert.ok([200, 302].includes(res.statusCode));
  await t.close();
});
