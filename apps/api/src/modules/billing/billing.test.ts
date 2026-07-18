import assert from 'node:assert/strict';
import { test } from 'node:test';

import { schema } from '@flowhub/database';
import { signStripePayload, StripePaymentGateway } from '@flowhub/payments';
import { eq } from 'drizzle-orm';

import {
  createTestApp,
  sessionCookieOf,
  skipWithoutDb,
  uniqueEmail,
  type TestApp,
} from '../../test-helpers.js';

const PASSWORD = 'correct-horse-battery';
const WEBHOOK_SECRET = 'whsec_billing_tests';

const MINIMAL_DEFINITION = {
  name: 'Limit flow',
  nodes: [
    { id: 'start', kind: 'trigger', name: 'Manual', config: { type: 'manual' } },
    { id: 'step', kind: 'transform', name: 'Step', config: {} },
  ],
  edges: [{ from: 'start', to: 'step' }],
};

async function signupWithOrg(
  t: TestApp,
  prefix: string,
): Promise<{ cookie: string; organizationId: string }> {
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
  assert.equal(org.statusCode, 201);
  return { cookie, organizationId: org.json().id as string };
}

test('subscription endpoint reports plan, limits and usage', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  try {
    const { cookie } = await signupWithOrg(t, 'billing-info');
    const res = await t.app.inject({
      method: 'GET',
      url: '/billing/subscription',
      headers: { cookie },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.planSlug, 'free');
    assert.equal(body.gateway, 'mock');
    assert.equal(body.usage.users, 1);
    assert.equal(body.limits.maxUsers, 1);

    const plans = await t.app.inject({ method: 'GET', url: '/billing/plans', headers: { cookie } });
    assert.equal(plans.statusCode, 200);
    assert.equal(plans.json().plans[0].slug, 'free');
  } finally {
    await t.close();
  }
});

test('mock checkout upgrades the plan synchronously', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  try {
    const { cookie } = await signupWithOrg(t, 'billing-up');
    const checkout = await t.app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { cookie },
      payload: { planSlug: 'pro' },
    });
    assert.equal(checkout.statusCode, 200);
    assert.match(checkout.json().url as string, /mock_checkout=pro/);

    const sub = await t.app.inject({
      method: 'GET',
      url: '/billing/subscription',
      headers: { cookie },
    });
    assert.equal(sub.json().planSlug, 'pro');
    assert.equal(sub.json().limits.maxUsers, 20);
  } finally {
    await t.close();
  }
});

test('plan limits block installs and invitations on free', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  try {
    const { cookie } = await signupWithOrg(t, 'billing-lim');

    // free allows 2 installed workflows: two creates pass, the third is blocked.
    for (const name of ['One', 'Two']) {
      const ok = await t.app.inject({
        method: 'POST',
        url: '/workflows',
        headers: { cookie },
        payload: { name, definition: MINIMAL_DEFINITION },
      });
      assert.equal(ok.statusCode, 201);
    }
    const blocked = await t.app.inject({
      method: 'POST',
      url: '/workflows',
      headers: { cookie },
      payload: { name: 'Three', definition: MINIMAL_DEFINITION },
    });
    assert.equal(blocked.statusCode, 403);
    assert.match(blocked.json().error.message, /Plan limit reached/);

    // free allows 1 user: any invitation is blocked.
    const invite = await t.app.inject({
      method: 'POST',
      url: '/organizations/current/invitations',
      headers: { cookie },
      payload: { email: uniqueEmail('blocked'), role: 'member' },
    });
    assert.equal(invite.statusCode, 403);

    // Upgrading (mock checkout) lifts both limits.
    await t.app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { cookie },
      payload: { planSlug: 'starter' },
    });
    const third = await t.app.inject({
      method: 'POST',
      url: '/workflows',
      headers: { cookie },
      payload: { name: 'Three again', definition: MINIMAL_DEFINITION },
    });
    assert.equal(third.statusCode, 201);
    const inviteOk = await t.app.inject({
      method: 'POST',
      url: '/organizations/current/invitations',
      headers: { cookie },
      payload: { email: uniqueEmail('allowed'), role: 'member' },
    });
    assert.equal(inviteOk.statusCode, 201);
  } finally {
    await t.close();
  }
});

test('execution monthly limit returns 429', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  try {
    const { cookie, organizationId } = await signupWithOrg(t, 'billing-exec');
    const created = await t.app.inject({
      method: 'POST',
      url: '/workflows',
      headers: { cookie },
      payload: { name: 'Runner', definition: MINIMAL_DEFINITION },
    });
    const workflowId = created.json().installedWorkflowId as string;

    // Pre-consume the whole free monthly execution budget (50).
    await t.handle.db.insert(schema.usageEvents).values({
      organizationId,
      eventType: 'execution.triggered',
      quantity: '50',
      occurredAt: new Date(),
    });
    const blocked = await t.app.inject({
      method: 'POST',
      url: `/workflows/${workflowId}/executions`,
      headers: { cookie },
    });
    assert.equal(blocked.statusCode, 429);
    assert.match(blocked.json().error.message, /executions this month/);
  } finally {
    await t.close();
  }
});

test(
  'stripe webhook applies plan changes with valid signature',
  { skip: skipWithoutDb },
  async () => {
    const gateway = new StripePaymentGateway({
      secretKey: 'sk_test_x',
      webhookSecret: WEBHOOK_SECRET,
    });
    const t = await createTestApp({ paymentGateway: gateway });
    try {
      const { organizationId } = await signupWithOrg(t, 'billing-wh');

      const completed = JSON.stringify({
        id: 'evt_test_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_1',
            subscription: 'sub_test_1',
            metadata: { organizationId, planSlug: 'business' },
          },
        },
      });
      const now = Math.floor(Date.now() / 1000);

      // Invalid signature → 401 and no change.
      const bad = await t.app.inject({
        method: 'POST',
        url: '/billing/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
        payload: completed,
      });
      assert.equal(bad.statusCode, 401);

      const good = await t.app.inject({
        method: 'POST',
        url: '/billing/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signStripePayload(completed, WEBHOOK_SECRET, now),
        },
        payload: completed,
      });
      assert.equal(good.statusCode, 200);
      const [sub] = await t.handle.db
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.organizationId, organizationId));
      assert.equal(sub?.planSlug, 'business');
      assert.equal(sub?.externalRef, 'sub_test_1');

      // Subscription cancelled → downgrade to free.
      const deleted = JSON.stringify({
        id: 'evt_test_2',
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_test_1', status: 'canceled' } },
      });
      const cancel = await t.app.inject({
        method: 'POST',
        url: '/billing/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signStripePayload(deleted, WEBHOOK_SECRET, now),
        },
        payload: deleted,
      });
      assert.equal(cancel.statusCode, 200);
      const [after] = await t.handle.db
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.organizationId, organizationId));
      assert.equal(after?.status, 'cancelled');
      assert.equal(after?.planSlug, 'free');
    } finally {
      await t.close();
    }
  },
);
