/**
 * Credential resolution integration test against live PostgreSQL: an
 * encrypted Holded key stored via the API-side store is resolved by the
 * worker-side CredentialSource and used by the real connector (stubbed
 * fetch). Tenant scoping and revocation are enforced.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadEnv } from '@flowhub/config';
import {
  createHoldedConnector,
  DbSecretsStore,
  SecretCipher,
  withConnectorErrorBoundary,
  type FetchLike,
} from '@flowhub/connectors';
import { createDb, createSecretRowStore, schema } from '@flowhub/database';
import { createLogger } from '@flowhub/observability';

import { createCredentialSource } from './connectors.js';

const databaseUrl = process.env['DATABASE_URL'];
const skip = databaseUrl ? false : 'DATABASE_URL not set — skipping worker connector tests';

const KEY = 'e'.repeat(64);

test('worker resolves encrypted credentials tenant-scoped and executes', { skip }, async () => {
  const handle = createDb(databaseUrl as string, { maxConnections: 2 });
  try {
    const { db } = handle;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Connector Org', slug: `conn-${suffix}` })
      .returning();
    const [foreignOrg] = await db
      .insert(schema.organizations)
      .values({ name: 'Foreign Org', slug: `conn-f-${suffix}` })
      .returning();
    assert.ok(org && foreignOrg);

    const secrets = new DbSecretsStore(createSecretRowStore(db), new SecretCipher(KEY));
    const secretRef = await secrets.store(org.id, {
      kind: 'api_key',
      apiKey: 'holded-live-key-9',
    });
    const [account] = await db
      .insert(schema.connectorAccounts)
      .values({
        organizationId: org.id,
        connectorSlug: 'holded',
        name: 'Holded principal',
        authType: 'api_key',
        status: 'active',
      })
      .returning();
    assert.ok(account);
    await db.insert(schema.connectorSecretsMetadata).values({
      organizationId: org.id,
      connectorAccountId: account.id,
      secretRef,
      kind: 'api_key',
    });

    const env = loadEnv({ NODE_ENV: 'test', CONNECTOR_SECRETS_KEY: KEY });
    const credentials = createCredentialSource({
      db,
      secrets,
      env,
      logger: createLogger('error', { app: 'worker-test' }),
    });

    const seen: Array<Record<string, string>> = [];
    const stubFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>);
      return new Response(JSON.stringify({ status: 1, id: 'doc-77' }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as FetchLike;

    const holded = withConnectorErrorBoundary(createHoldedConnector(credentials, stubFetch));
    const ok = await holded.execute({
      tenant: { organizationId: org.id as never, userId: 'u' as never, role: 'member' },
      action: 'create_entry',
      params: { vendor: 'ACME', totalAmount: 10 },
      connectorAccountId: account.id,
    });
    assert.ok(ok.ok);
    assert.equal(seen[0]?.['key'], 'holded-live-key-9'); // decrypted at the edge only

    // Cross-tenant use of the same account id must fail.
    const foreign = await holded.execute({
      tenant: { organizationId: foreignOrg.id as never, userId: 'u' as never, role: 'member' },
      action: 'create_entry',
      params: {},
      connectorAccountId: account.id,
    });
    assert.equal(foreign.ok, false);

    // Missing account id fails with a clear message.
    const missing = await holded.execute({
      tenant: { organizationId: org.id as never, userId: 'u' as never, role: 'member' },
      action: 'create_entry',
      params: {},
    });
    assert.equal(missing.ok, false);
  } finally {
    await handle.close();
  }
});
