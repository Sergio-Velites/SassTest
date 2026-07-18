import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DbSecretsStore, SecretCipher, type SecretRowStore } from './crypto.js';
import { buildAuthorizationUrl, generatePkcePair } from './oauth.js';

const KEY = 'a'.repeat(64);

test('cipher roundtrips and produces unique ciphertexts', () => {
  const cipher = new SecretCipher(KEY);
  const secret = JSON.stringify({ accessToken: 'xoxb-super-secret' });
  const one = cipher.encrypt(secret);
  const two = cipher.encrypt(secret);
  assert.notEqual(one, two); // random IV per encryption
  assert.equal(cipher.decrypt(one), secret);
  assert.equal(cipher.decrypt(two), secret);
  assert.ok(!one.includes('xoxb')); // never plaintext
});

test('cipher rejects tampered ciphertext and bad keys', () => {
  const cipher = new SecretCipher(KEY);
  const encrypted = cipher.encrypt('payload');
  const tampered = encrypted.slice(0, -4) + 'AAAA';
  assert.throws(() => cipher.decrypt(tampered));
  assert.throws(() => new SecretCipher('too-short'), /64 hex/);
});

test('DbSecretsStore stores encrypted rows scoped by organization', async () => {
  const rows = new Map<string, { org: string; ciphertext: string }>();
  let counter = 0;
  const rowStore: SecretRowStore = {
    async insert(org, ciphertext) {
      const id = `row-${++counter}`;
      rows.set(id, { org, ciphertext });
      return id;
    },
    async get(org, id) {
      const row = rows.get(id);
      return row && row.org === org ? row.ciphertext : null;
    },
    async remove(org, id) {
      const row = rows.get(id);
      if (row && row.org === org) rows.delete(id);
    },
  };
  const store = new DbSecretsStore(rowStore, new SecretCipher(KEY));
  const ref = await store.store('org-a', { kind: 'oauth_tokens', accessToken: 'tok-123' });
  assert.match(ref, /^local:/);
  assert.ok(![...rows.values()].some((r) => r.ciphertext.includes('tok-123')));

  const loaded = await store.retrieve('org-a', ref);
  assert.equal(loaded?.accessToken, 'tok-123');
  // Cross-tenant retrieval yields nothing.
  assert.equal(await store.retrieve('org-b', ref), null);

  await store.delete('org-a', ref);
  assert.equal(await store.retrieve('org-a', ref), null);
});

test('authorization URL carries PKCE challenge and state', () => {
  const { verifier, challenge } = generatePkcePair();
  assert.ok(verifier.length >= 43 && challenge.length >= 43);
  const url = new URL(
    buildAuthorizationUrl({
      provider: {
        slug: 'fake',
        authorizationUrl: 'https://fake.example/authorize',
        tokenUrl: 'https://fake.example/token',
        scopes: ['a', 'b'],
      },
      clientId: 'client-1',
      redirectUri: 'https://api.example/connector-accounts/callback',
      state: 'state-xyz',
      codeChallenge: challenge,
    }),
  );
  assert.equal(url.searchParams.get('code_challenge'), challenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'state-xyz');
  assert.equal(url.searchParams.get('scope'), 'a b');
});
