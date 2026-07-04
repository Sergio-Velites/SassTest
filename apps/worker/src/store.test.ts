/**
 * Integration tests: runExecution + DrizzleExecutionStore against live
 * PostgreSQL. Skip cleanly without DATABASE_URL (CI provides a postgres
 * service). This is the same wiring the worker uses in production.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MockAiProvider, providerPort } from '@flowhub/ai-gateway';
import { createMockConnectorRegistry } from '@flowhub/connectors';
import { createDb, schema, type DbHandle } from '@flowhub/database';
import { createLogger } from '@flowhub/observability';
import { runExecution, type ExecutorDeps } from '@flowhub/workflow-engine';
import { and, eq } from 'drizzle-orm';

import { DrizzleExecutionStore } from './store.js';

const databaseUrl = process.env['DATABASE_URL'];
const skip = databaseUrl ? false : 'DATABASE_URL not set — skipping worker integration tests';

const INVOICE_INTAKE = {
  name: 'Invoice Intake (worker test)',
  description: '',
  variables: { approvalThresholdEur: '500' },
  nodes: [
    { id: 'start', kind: 'trigger', name: 'Manual', config: {} },
    {
      id: 'receive-email',
      kind: 'action',
      name: 'Receive',
      config: { connector: 'gmail-mock', action: 'fetch_email_with_attachment' },
    },
    {
      id: 'extract',
      kind: 'ai',
      name: 'Extract',
      config: {
        promptTemplate: 'invoice-extract@1',
        input: { document: '{{nodes.receive-email.attachmentText}}' },
      },
    },
    {
      id: 'amount-check',
      kind: 'condition',
      name: 'Check',
      config: { expression: '{{nodes.extract.totalAmount}} < {{variables.approvalThresholdEur}}' },
    },
    {
      id: 'approval',
      kind: 'approval',
      name: 'Approve',
      config: { title: 'Aprobar {{nodes.extract.vendor}}', requiredRole: 'member' },
    },
    {
      id: 'register',
      kind: 'action',
      name: 'Register',
      config: { connector: 'accounting-mock', action: 'create_entry', params: {} },
    },
  ],
  edges: [
    { from: 'start', to: 'receive-email' },
    { from: 'receive-email', to: 'extract' },
    { from: 'extract', to: 'amount-check' },
    { from: 'amount-check', to: 'register', branch: 'true' },
    { from: 'amount-check', to: 'approval', branch: 'false' },
    { from: 'approval', to: 'register', branch: 'approved' },
    { from: 'approval', to: 'register', branch: 'rejected' },
  ],
};

async function seedExecution(handle: DbHandle, totalAmount: number) {
  const { db } = handle;
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Worker Test Org', slug: `worker-${suffix}` })
    .returning();
  assert.ok(org);
  const [installed] = await db
    .insert(schema.installedWorkflows)
    .values({ organizationId: org.id, name: 'Worker test wf' })
    .returning();
  assert.ok(installed);
  const [version] = await db
    .insert(schema.workflowVersions)
    .values({
      organizationId: org.id,
      installedWorkflowId: installed.id,
      version: 1,
      definition: INVOICE_INTAKE,
      isCurrent: true,
    })
    .returning();
  assert.ok(version);
  const [execution] = await db
    .insert(schema.workflowExecutions)
    .values({
      organizationId: org.id,
      installedWorkflowId: installed.id,
      workflowVersionId: version.id,
      status: 'pending',
      triggerType: 'manual',
    })
    .returning();
  assert.ok(execution);

  const deps: ExecutorDeps = {
    store: new DrizzleExecutionStore(db),
    connectors: createMockConnectorRegistry(),
    ai: providerPort(
      new MockAiProvider({
        'invoice-extract@1': { vendor: 'ACME', totalAmount, date: '2026-06-28', vatAmount: 1 },
      }),
    ),
    logger: createLogger('error', { app: 'worker-test' }),
    sleep: async () => {},
  };
  return { db, org, execution, deps };
}

test(
  'below-threshold invoice runs to succeeded with persisted steps and logs',
  { skip },
  async () => {
    const handle = createDb(databaseUrl as string, { maxConnections: 3 });
    try {
      const { db, execution, deps } = await seedExecution(handle, 342.5);
      await runExecution(execution.id, deps);

      const [after] = await db
        .select()
        .from(schema.workflowExecutions)
        .where(eq(schema.workflowExecutions.id, execution.id));
      assert.equal(after?.status, 'succeeded');
      assert.ok(after?.startedAt && after?.finishedAt);

      const steps = await db
        .select()
        .from(schema.workflowExecutionSteps)
        .where(eq(schema.workflowExecutionSteps.workflowExecutionId, execution.id));
      const byNode = new Map(steps.map((s) => [s.nodeId, s]));
      assert.equal(byNode.get('register')?.status, 'succeeded');
      assert.equal(byNode.get('amount-check')?.branch, 'true');

      const logs = await db
        .select()
        .from(schema.workflowExecutionLogs)
        .where(eq(schema.workflowExecutionLogs.workflowExecutionId, execution.id));
      assert.ok(logs.length >= steps.length); // at least one log per executed node
    } finally {
      await handle.close();
    }
  },
);

test(
  'above-threshold invoice pauses, approval row exists, resume completes',
  { skip },
  async () => {
    const handle = createDb(databaseUrl as string, { maxConnections: 3 });
    try {
      const { db, execution, deps } = await seedExecution(handle, 1200);
      await runExecution(execution.id, deps);

      const [paused] = await db
        .select()
        .from(schema.workflowExecutions)
        .where(eq(schema.workflowExecutions.id, execution.id));
      assert.equal(paused?.status, 'waiting_approval');

      const [approval] = await db
        .select()
        .from(schema.approvalRequests)
        .where(
          and(
            eq(schema.approvalRequests.workflowExecutionId, execution.id),
            eq(schema.approvalRequests.status, 'pending'),
          ),
        );
      assert.ok(approval);
      assert.equal(approval.title, 'Aprobar ACME');

      // A human approves (the API does exactly this update + re-enqueue).
      await db
        .update(schema.approvalRequests)
        .set({ status: 'approved', resolvedAt: new Date() })
        .where(eq(schema.approvalRequests.id, approval.id));
      await runExecution(execution.id, deps);

      const [finished] = await db
        .select()
        .from(schema.workflowExecutions)
        .where(eq(schema.workflowExecutions.id, execution.id));
      assert.equal(finished?.status, 'succeeded');

      const [registerStep] = await db
        .select()
        .from(schema.workflowExecutionSteps)
        .where(
          and(
            eq(schema.workflowExecutionSteps.workflowExecutionId, execution.id),
            eq(schema.workflowExecutionSteps.nodeId, 'register'),
          ),
        );
      assert.equal(registerStep?.status, 'succeeded');
    } finally {
      await handle.close();
    }
  },
);
