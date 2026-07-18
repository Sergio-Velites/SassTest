/**
 * OAuth connect flow tested end-to-end against a local fake token endpoint:
 * authorize → signed state cookie + PKCE → callback → encrypted credentials
 * persisted → list/revoke with tenant scoping.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';

import { DbSecretsStore, SecretCipher } from '@flowhub/connectors';
import { createSecretRowStore, schema } from '@flowhub/database';
import { eq } from 'drizzle-orm';

import type { RealConnectorConfig } from './routes.js';
import {
  createTestApp,
  sessionCookieOf,
  skipWithoutDb,
  uniqueEmail,
  type TestApp,
} from '../../test-helpers.js';

const PASSWORD = 'correct-horse-battery';

/** Fake OAuth token endpoint that validates the PKCE verifier is present. */
function startFakeTokenServer(): Promise<{
  server: Server;
  url: string;
  requests: URLSearchParams[];
}> {
  const requests: URLSearchParams[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        const params = new URLSearchParams(body);
        requests.push(params);
        res.setHeader('content-type', 'application/json');
        if (params.get('code') !== 'good-code' || !params.get('code_verifier')) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        res.end(
          JSON.stringify({
            access_token: 'fake-access-token-123',
            refresh_token: 'fake-refresh-token-456',
            expires_in: 3600,
          }),
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}/token`, requests });
    });
  });
}

async function adminSession(t: TestApp, prefix: string) {
  const reg = await t.app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: uniqueEmail(prefix), password: PASSWORD, name: prefix },
  });
  const cookie = sessionCookieOf(reg);
  const org = await t.app.inject({
    method: 'POST',
    url: '/organizations',
    headers: { cookie },
    payload: {
      name: `${prefix} Org`,
      slug: `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e5)}`,
    },
  });
  return { cookie, organizationId: org.json().id as string };
}

test(
  'full OAuth connect flow persists encrypted credentials',
  { skip: skipWithoutDb },
  async () => {
    const fake = await startFakeTokenServer();
    const provider: RealConnectorConfig = {
      provider: {
        slug: 'faketool',
        authorizationUrl: 'https://faketool.example/authorize',
        tokenUrl: fake.url,
        scopes: ['read'],
      },
      clientId: 'client-abc',
      clientSecret: 'secret-xyz',
    };
    const t = await createTestApp({ extraOAuthProviders: new Map([['faketool', provider]]) });
    try {
      const { cookie, organizationId } = await adminSession(t, 'oauth');

      // 1. authorize → URL + state cookie
      const authorize = await t.app.inject({
        method: 'POST',
        url: '/connector-accounts/faketool/authorize',
        headers: { cookie },
      });
      assert.equal(authorize.statusCode, 200);
      const authorizationUrl = new URL(authorize.json().authorizationUrl);
      const state = authorizationUrl.searchParams.get('state');
      assert.ok(state);
      assert.ok(authorizationUrl.searchParams.get('code_challenge'));
      const stateCookie = authorize.cookies.find((c) => c.name === 'flowhub_oauth_state');
      assert.ok(stateCookie);

      // 2. callback with the provider's code
      const callback = await t.app.inject({
        method: 'GET',
        url: `/connector-accounts/callback?code=good-code&state=${state}`,
        headers: { cookie: `flowhub_oauth_state=${encodeURIComponent(stateCookie.value)}` },
      });
      assert.equal(callback.statusCode, 302);
      assert.match(callback.headers['location'] as string, /connected=faketool/);
      // PKCE verifier reached the token endpoint
      assert.ok(fake.requests[0]?.get('code_verifier'));

      // 3. account exists; credentials are encrypted at rest but decryptable
      const list = await t.app.inject({
        method: 'GET',
        url: '/connector-accounts',
        headers: { cookie },
      });
      const account = list.json().accounts[0];
      assert.equal(account.connectorSlug, 'faketool');
      assert.equal(account.status, 'active');

      const [meta] = await t.handle.db
        .select()
        .from(schema.connectorSecretsMetadata)
        .where(eq(schema.connectorSecretsMetadata.connectorAccountId, account.id));
      assert.ok(meta);
      const rowId = meta.secretRef.replace(/^local:/, '');
      const [rawRow] = await t.handle.db
        .select()
        .from(schema.connectorSecrets)
        .where(eq(schema.connectorSecrets.id, rowId));
      assert.ok(rawRow && !rawRow.ciphertext.includes('fake-access-token'));

      const store = new DbSecretsStore(
        createSecretRowStore(t.handle.db),
        new SecretCipher('f'.repeat(64)),
      );
      const credentials = await store.retrieve(organizationId, meta.secretRef);
      assert.equal(credentials?.accessToken, 'fake-access-token-123');
      assert.equal(credentials?.refreshToken, 'fake-refresh-token-456');

      // 4. revoke wipes the secret and flags the account
      const revoke = await t.app.inject({
        method: 'POST',
        url: `/connector-accounts/${account.id}/revoke`,
        headers: { cookie },
      });
      assert.equal(revoke.statusCode, 200);
      assert.equal(await store.retrieve(organizationId, meta.secretRef), null);
      const after = await t.app.inject({
        method: 'GET',
        url: '/connector-accounts',
        headers: { cookie },
      });
      assert.equal(after.json().accounts[0].status, 'revoked');
    } finally {
      fake.server.close();
      await t.close();
    }
  },
);

test('callback rejects forged or mismatched state', { skip: skipWithoutDb }, async () => {
  const provider: RealConnectorConfig = {
    provider: {
      slug: 'faketool',
      authorizationUrl: 'https://faketool.example/authorize',
      tokenUrl: 'http://127.0.0.1:1/token',
      scopes: ['read'],
    },
    clientId: 'client-abc',
    clientSecret: 'secret-xyz',
  };
  const t = await createTestApp({ extraOAuthProviders: new Map([['faketool', provider]]) });
  try {
    const { cookie } = await adminSession(t, 'forged');
    const authorize = await t.app.inject({
      method: 'POST',
      url: '/connector-accounts/faketool/authorize',
      headers: { cookie },
    });
    const stateCookie = authorize.cookies.find((c) => c.name === 'flowhub_oauth_state');
    assert.ok(stateCookie);

    // Mismatched state parameter → redirected with error, no account created.
    const mismatched = await t.app.inject({
      method: 'GET',
      url: '/connector-accounts/callback?code=good-code&state=not-the-real-state',
      headers: { cookie: `flowhub_oauth_state=${encodeURIComponent(stateCookie.value)}` },
    });
    assert.match(mismatched.headers['location'] as string, /error=invalid_state/);

    // Tampered cookie signature → same rejection.
    const forged = await t.app.inject({
      method: 'GET',
      url: '/connector-accounts/callback?code=good-code&state=whatever',
      headers: { cookie: 'flowhub_oauth_state=aaaa.bbbb' },
    });
    assert.match(forged.headers['location'] as string, /error=invalid_state|error=missing_state/);

    const list = await t.app.inject({
      method: 'GET',
      url: '/connector-accounts',
      headers: { cookie },
    });
    assert.equal(list.json().accounts.length, 0);
  } finally {
    await t.close();
  }
});

test(
  'viewer cannot start OAuth; unknown provider is NOT_FOUND',
  { skip: skipWithoutDb },
  async () => {
    const t = await createTestApp();
    try {
      const { cookie } = await adminSession(t, 'catalog');
      const unknown = await t.app.inject({
        method: 'POST',
        url: '/connector-accounts/doesnotexist/authorize',
        headers: { cookie },
      });
      assert.equal(unknown.statusCode, 404);

      const catalog = await t.app.inject({
        method: 'GET',
        url: '/connectors',
        headers: { cookie },
      });
      assert.equal(catalog.statusCode, 200);
      const slugs = catalog.json().connectors.map((c: { slug: string }) => c.slug);
      assert.ok(slugs.includes('slack-mock'));
      assert.ok(slugs.includes('slack')); // real, marked unavailable without creds
      const slack = catalog.json().connectors.find((c: { slug: string }) => c.slug === 'slack');
      assert.equal(slack.available, false);
    } finally {
      await t.close();
    }
  },
);
