import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MockPaymentGateway } from './mock.js';
import {
  signStripePayload,
  StripePaymentGateway,
  verifyStripeSignature,
  type FetchLike,
} from './stripe.js';

const SECRET = 'whsec_test_secret';
const EVENT = JSON.stringify({
  id: 'evt_1',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_1', metadata: { organizationId: 'org-1', planSlug: 'pro' } } },
});

test('valid stripe signature verifies and parses the event', () => {
  const now = 1_750_000_000_000;
  const header = signStripePayload(EVENT, SECRET, Math.floor(now / 1000));
  const event = verifyStripeSignature({
    payload: EVENT,
    header,
    secret: SECRET,
    toleranceSeconds: 300,
    nowMs: now,
  });
  assert.equal(event.id, 'evt_1');
  assert.equal(event.type, 'checkout.session.completed');
  assert.deepEqual((event.data['metadata'] as Record<string, string>)['planSlug'], 'pro');
});

test('tampered payload is rejected', () => {
  const now = 1_750_000_000_000;
  const header = signStripePayload(EVENT, SECRET, Math.floor(now / 1000));
  assert.throws(
    () =>
      verifyStripeSignature({
        payload: EVENT.replace('pro', 'enterprise'),
        header,
        secret: SECRET,
        toleranceSeconds: 300,
        nowMs: now,
      }),
    /signature mismatch/,
  );
});

test('wrong secret and malformed headers are rejected', () => {
  const now = 1_750_000_000_000;
  const header = signStripePayload(EVENT, 'whsec_other', Math.floor(now / 1000));
  assert.throws(
    () =>
      verifyStripeSignature({
        payload: EVENT,
        header,
        secret: SECRET,
        toleranceSeconds: 300,
        nowMs: now,
      }),
    /signature mismatch/,
  );
  assert.throws(
    () =>
      verifyStripeSignature({
        payload: EVENT,
        header: 'garbage',
        secret: SECRET,
        toleranceSeconds: 300,
        nowMs: now,
      }),
    /Malformed/,
  );
});

test('stale timestamps are rejected (replay protection)', () => {
  const now = 1_750_000_000_000;
  const header = signStripePayload(EVENT, SECRET, Math.floor(now / 1000) - 3600);
  assert.throws(
    () =>
      verifyStripeSignature({
        payload: EVENT,
        header,
        secret: SECRET,
        toleranceSeconds: 300,
        nowMs: now,
      }),
    /tolerance/,
  );
});

test('stripe checkout posts form-encoded with metadata and bearer auth', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const stub: FetchLike = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return new Response(
      JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.test/x' }),
      {
        headers: { 'content-type': 'application/json' },
      },
    );
  };
  const gateway = new StripePaymentGateway({
    secretKey: 'sk_test_123',
    webhookSecret: SECRET,
    fetchImpl: stub,
  });
  const session = await gateway.createCheckoutSession({
    organizationId: 'org-9',
    planSlug: 'pro',
    priceCents: 9900,
    currency: 'EUR',
    successUrl: 'http://localhost:3000/billing?ok=1',
    cancelUrl: 'http://localhost:3000/billing',
    customerEmail: 'owner@corp.example',
  });
  assert.equal(session.sessionId, 'cs_test_1');
  assert.equal(session.url, 'https://checkout.stripe.test/x');
  const call = calls[0];
  assert.ok(call);
  assert.match(call.url, /checkout\/sessions$/);
  const headers = call.init?.headers as Record<string, string>;
  assert.equal(headers['authorization'], 'Bearer sk_test_123');
  const body = String(call.init?.body);
  assert.match(body, /metadata%5BorganizationId%5D=org-9/);
  assert.match(body, /metadata%5BplanSlug%5D=pro/);
  assert.match(body, /unit_amount%5D=9900/);
});

test('mock gateway returns the success url and records the session', async () => {
  const mock = new MockPaymentGateway();
  const session = await mock.createCheckoutSession({
    organizationId: 'org-1',
    planSlug: 'starter',
    priceCents: 2900,
    currency: 'EUR',
    successUrl: 'http://localhost:3000/billing',
    cancelUrl: 'http://localhost:3000/billing',
  });
  assert.equal(session.url, 'http://localhost:3000/billing?mock_checkout=starter');
  assert.equal(mock.checkoutSessions.length, 1);
  assert.throws(() => mock.verifyWebhook('{}', 'wrong'), /Invalid mock signature/);
  const event = mock.verifyWebhook(EVENT, 'mock-signature');
  assert.equal(event.type, 'checkout.session.completed');
});
