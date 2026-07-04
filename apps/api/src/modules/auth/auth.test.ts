import assert from 'node:assert/strict';
import { test } from 'node:test';

import { schema } from '@flowhub/database';

import { createTestApp, sessionCookieOf, skipWithoutDb, uniqueEmail } from '../../test-helpers.js';

const PASSWORD = 'correct-horse-battery';

test('register → me → logout lifecycle', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  try {
    const email = uniqueEmail('reg');
    const reg = await t.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: PASSWORD, name: 'Reg User' },
    });
    assert.equal(reg.statusCode, 201);
    const cookie = sessionCookieOf(reg);

    const me = await t.app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.email, email);

    const out = await t.app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    assert.equal(out.statusCode, 204);

    // Session is revoked server-side — the same cookie no longer works.
    const meAfter = await t.app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    assert.equal(meAfter.statusCode, 401);
  } finally {
    await t.close();
  }
});

test('duplicate registration returns CONFLICT', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  try {
    const email = uniqueEmail('dup');
    const first = await t.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: PASSWORD, name: 'First' },
    });
    assert.equal(first.statusCode, 201);
    const second = await t.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: PASSWORD, name: 'Second' },
    });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().error.code, 'CONFLICT');
  } finally {
    await t.close();
  }
});

test(
  'login rejects bad password with the same message as unknown email',
  { skip: skipWithoutDb },
  async () => {
    const t = await createTestApp();
    try {
      const email = uniqueEmail('login');
      await t.app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password: PASSWORD, name: 'Login User' },
      });
      const bad = await t.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'wrong-password-123' },
      });
      const unknown = await t.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: uniqueEmail('ghost'), password: PASSWORD },
      });
      assert.equal(bad.statusCode, 401);
      assert.equal(unknown.statusCode, 401);
      assert.deepEqual(bad.json(), unknown.json());

      const good = await t.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: PASSWORD },
      });
      assert.equal(good.statusCode, 200);
    } finally {
      await t.close();
    }
  },
);

test(
  'me without cookie is UNAUTHORIZED; forged cookie is rejected',
  { skip: skipWithoutDb },
  async () => {
    const t = await createTestApp();
    try {
      const anon = await t.app.inject({ method: 'GET', url: '/auth/me' });
      assert.equal(anon.statusCode, 401);
      const forged = await t.app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { cookie: 'flowhub_session=deadbeef.invalid-signature' },
      });
      assert.equal(forged.statusCode, 401);
    } finally {
      await t.close();
    }
  },
);

test(
  'switch-organization enforces membership and hides foreign orgs',
  { skip: skipWithoutDb },
  async () => {
    const t = await createTestApp();
    try {
      const email = uniqueEmail('switch');
      const reg = await t.app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password: PASSWORD, name: 'Switcher' },
      });
      const cookie = sessionCookieOf(reg);
      const userId = reg.json().user.id as string;

      // Org the user belongs to + a foreign org, created directly in DB.
      const [ownOrg] = await t.handle.db
        .insert(schema.organizations)
        .values({ name: 'Own Org', slug: `own-${Date.now()}-${Math.floor(Math.random() * 1e6)}` })
        .returning();
      const [foreignOrg] = await t.handle.db
        .insert(schema.organizations)
        .values({
          name: 'Foreign Org',
          slug: `foreign-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        })
        .returning();
      assert.ok(ownOrg && foreignOrg);
      await t.handle.db
        .insert(schema.organizationMembers)
        .values({ organizationId: ownOrg.id, userId, role: 'admin' });

      const ok = await t.app.inject({
        method: 'POST',
        url: '/auth/switch-organization',
        headers: { cookie },
        payload: { organizationId: ownOrg.id },
      });
      assert.equal(ok.statusCode, 200);
      assert.equal(ok.json().activeOrganizationId, ownOrg.id);

      // Foreign org responds NOT_FOUND — existence must not leak.
      const denied = await t.app.inject({
        method: 'POST',
        url: '/auth/switch-organization',
        headers: { cookie },
        payload: { organizationId: foreignOrg.id },
      });
      assert.equal(denied.statusCode, 404);
      assert.equal(denied.json().error.code, 'NOT_FOUND');
    } finally {
      await t.close();
    }
  },
);
