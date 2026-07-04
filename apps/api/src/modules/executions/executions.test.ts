import assert from 'node:assert/strict';
import { test } from 'node:test';

import { schema } from '@flowhub/database';

import {
  createTestApp,
  sessionCookieOf,
  skipWithoutDb,
  uniqueEmail,
  type TestApp,
} from '../../test-helpers.js';

const PASSWORD = 'correct-horse-battery';

const MINIMAL_DEFINITION = {
  name: 'Exec flow',
  description: '',
  nodes: [
    { id: 'start', kind: 'trigger', name: 'Manual', config: { type: 'manual' } },
    { id: 'step', kind: 'transform', name: 'Step', config: {} },
  ],
  edges: [{ from: 'start', to: 'step' }],
};

async function setupWorkflow(t: TestApp, prefix: string) {
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
    payload: { name: 'Exec test', definition: MINIMAL_DEFINITION },
  });
  return { cookie, organizationId, workflowId: wf.json().installedWorkflowId as string };
}

test('manual execution is created pending and enqueued once', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  try {
    const { cookie, workflowId } = await setupWorkflow(t, 'runner');
    const run = await t.app.inject({
      method: 'POST',
      url: `/workflows/${workflowId}/executions`,
      headers: { cookie },
    });
    assert.equal(run.statusCode, 201);
    const executionId = run.json().executionId as string;

    // Enqueued exactly once with the tenant in the payload.
    const jobs = t.queue.history.filter((j) => j.payload.executionId === executionId);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.type, 'execution.run');

    const list = await t.app.inject({ method: 'GET', url: '/executions', headers: { cookie } });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().executions[0].id, executionId);
    assert.equal(list.json().executions[0].status, 'pending');

    const detail = await t.app.inject({
      method: 'GET',
      url: `/executions/${executionId}`,
      headers: { cookie },
    });
    assert.equal(detail.statusCode, 200);

    const steps = await t.app.inject({
      method: 'GET',
      url: `/executions/${executionId}/steps`,
      headers: { cookie },
    });
    assert.deepEqual(steps.json().steps, []);
    const logs = await t.app.inject({
      method: 'GET',
      url: `/executions/${executionId}/logs`,
      headers: { cookie },
    });
    assert.deepEqual(logs.json().logs, []);
  } finally {
    await t.close();
  }
});

test('executions are tenant-isolated', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  try {
    const a = await setupWorkflow(t, 'exec-a');
    const run = await t.app.inject({
      method: 'POST',
      url: `/workflows/${a.workflowId}/executions`,
      headers: { cookie: a.cookie },
    });
    const executionId = run.json().executionId as string;

    const b = await setupWorkflow(t, 'exec-b');
    const foreign = await t.app.inject({
      method: 'GET',
      url: `/executions/${executionId}`,
      headers: { cookie: b.cookie },
    });
    assert.equal(foreign.statusCode, 404);
  } finally {
    await t.close();
  }
});

test(
  'approval resolve updates status, audits and re-enqueues the execution',
  { skip: skipWithoutDb },
  async () => {
    const t = await createTestApp();
    try {
      const { cookie, organizationId, workflowId } = await setupWorkflow(t, 'approver');
      const run = await t.app.inject({
        method: 'POST',
        url: `/workflows/${workflowId}/executions`,
        headers: { cookie },
      });
      const executionId = run.json().executionId as string;

      // Simulate the engine pausing on an approval node.
      const [approval] = await t.handle.db
        .insert(schema.approvalRequests)
        .values({
          organizationId,
          workflowExecutionId: executionId,
          nodeId: 'approval',
          title: 'Approve invoice',
          requiredRole: 'member',
          status: 'pending',
        })
        .returning();
      assert.ok(approval);

      const pending = await t.app.inject({ method: 'GET', url: '/approvals', headers: { cookie } });
      assert.equal(pending.json().approvals.length, 1);

      const resolve = await t.app.inject({
        method: 'POST',
        url: `/approvals/${approval.id}/resolve`,
        headers: { cookie },
        payload: { decision: 'approved', comment: 'ok' },
      });
      assert.equal(resolve.statusCode, 200);
      assert.equal(resolve.json().status, 'approved');

      // Resume job enqueued with the approval reference.
      const resumeJobs = t.queue.history.filter((j) => j.payload.approvalRequestId === approval.id);
      assert.equal(resumeJobs.length, 1);

      // Second resolution attempt conflicts.
      const again = await t.app.inject({
        method: 'POST',
        url: `/approvals/${approval.id}/resolve`,
        headers: { cookie },
        payload: { decision: 'rejected' },
      });
      assert.equal(again.statusCode, 409);
    } finally {
      await t.close();
    }
  },
);
