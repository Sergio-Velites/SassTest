/**
 * Systematic multi-tenant isolation suite (SECURITY_MODEL.md T1, Cycle 9).
 * Two organizations are seeded; every tenant-scoped read/write surface is
 * probed with the other tenant's resource ids. The contract everywhere:
 * foreign resources answer NOT_FOUND (never FORBIDDEN — existence must not
 * leak) and lists never contain foreign rows.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { schema } from '@flowhub/database';

import {
  createTestApp,
  sessionCookieOf,
  skipWithoutDb,
  uniqueEmail,
  type TestApp,
} from './test-helpers.js';

const PASSWORD = 'correct-horse-battery';

const DEFINITION = {
  name: 'Isolation probe',
  description: '',
  nodes: [
    { id: 'start', kind: 'trigger', name: 'Manual', config: {} },
    { id: 'step', kind: 'transform', name: 'Step', config: { assign: { ok: 'yes' } } },
  ],
  edges: [{ from: 'start', to: 'step' }],
};

interface Tenant {
  cookie: string;
  organizationId: string;
  workflowId: string;
  executionId: string;
  approvalId: string;
}

async function seedTenant(t: TestApp, prefix: string): Promise<Tenant> {
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
  const organizationId = org.json().id as string;
  const wf = await t.app.inject({
    method: 'POST',
    url: '/workflows',
    headers: { cookie },
    payload: { name: `${prefix} wf`, definition: DEFINITION },
  });
  const workflowId = wf.json().installedWorkflowId as string;
  const run = await t.app.inject({
    method: 'POST',
    url: `/workflows/${workflowId}/executions`,
    headers: { cookie },
  });
  const executionId = run.json().executionId as string;
  const [approval] = await t.handle.db
    .insert(schema.approvalRequests)
    .values({
      organizationId,
      workflowExecutionId: executionId,
      nodeId: 'probe',
      title: `${prefix} approval`,
      requiredRole: 'member',
      status: 'pending',
    })
    .returning();
  assert.ok(approval);
  return { cookie, organizationId, workflowId, executionId, approvalId: approval.id };
}

test('every tenant-scoped surface hides foreign resources', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  try {
    const a = await seedTenant(t, 'iso-a');
    const b = await seedTenant(t, 'iso-b');

    // B probes every A resource by id: always NOT_FOUND, never FORBIDDEN.
    const probes: Array<{
      method: 'GET' | 'POST';
      url: string;
      payload?: Record<string, unknown>;
    }> = [
      { method: 'GET', url: `/workflows/${a.workflowId}` },
      { method: 'POST', url: `/workflows/${a.workflowId}/executions` },
      { method: 'GET', url: `/executions/${a.executionId}` },
      { method: 'GET', url: `/executions/${a.executionId}/steps` },
      { method: 'GET', url: `/executions/${a.executionId}/logs` },
      {
        method: 'POST',
        url: `/approvals/${a.approvalId}/resolve`,
        payload: { decision: 'approved' },
      },
      {
        method: 'POST',
        url: '/auth/switch-organization',
        payload: { organizationId: a.organizationId },
      },
    ];
    for (const probe of probes) {
      const res = await t.app.inject({
        method: probe.method,
        url: probe.url,
        headers: { cookie: b.cookie },
        ...(probe.payload !== undefined ? { payload: probe.payload } : {}),
      });
      assert.equal(res.statusCode, 404, `${probe.method} ${probe.url} → ${res.statusCode}`);
      assert.equal(res.json().error.code, 'NOT_FOUND', `${probe.url} must not leak existence`);
    }

    // B's list endpoints never contain A's rows.
    const workflows = await t.app.inject({
      method: 'GET',
      url: '/workflows',
      headers: { cookie: b.cookie },
    });
    assert.ok(
      !workflows.json().workflows.some((w: { id: string }) => w.id === a.workflowId),
      'workflow list leaked a foreign row',
    );
    const executions = await t.app.inject({
      method: 'GET',
      url: '/executions',
      headers: { cookie: b.cookie },
    });
    assert.ok(
      !executions.json().executions.some((e: { id: string }) => e.id === a.executionId),
      'execution list leaked a foreign row',
    );
    const approvals = await t.app.inject({
      method: 'GET',
      url: '/approvals',
      headers: { cookie: b.cookie },
    });
    assert.ok(
      !approvals.json().approvals.some((x: { id: string }) => x.id === a.approvalId),
      'approval list leaked a foreign row',
    );
    const members = await t.app.inject({
      method: 'GET',
      url: '/organizations/current/members',
      headers: { cookie: b.cookie },
    });
    assert.equal(members.json().members.length, 1, 'member list leaked foreign members');

    // And A still sees its own data (the filters are scoping, not breaking).
    const own = await t.app.inject({
      method: 'GET',
      url: `/executions/${a.executionId}`,
      headers: { cookie: a.cookie },
    });
    assert.equal(own.statusCode, 200);
  } finally {
    await t.close();
  }
});

test('auth endpoints are rate limited (brute-force guard)', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  try {
    let lastStatus = 0;
    for (let i = 0; i < 12; i++) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'nobody@flowhub.local', password: 'wrong-password' },
      });
      lastStatus = res.statusCode;
    }
    assert.equal(lastStatus, 429);
  } finally {
    await t.close();
  }
});
