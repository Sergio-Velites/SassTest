import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MockAiProvider } from '@flowhub/ai-gateway';
import { createMockConnectorRegistry, type Connector } from '@flowhub/connectors';
import { createLogger } from '@flowhub/observability';

import { runExecution, type ExecutorDeps } from './executor.js';
import { InMemoryExecutionStore } from './memory-store.js';

const silentLogger = createLogger('error', { app: 'engine-test' });

function makeDeps(
  store: InMemoryExecutionStore,
  options?: { ai?: MockAiProvider; connectors?: Map<string, Connector> },
): ExecutorDeps {
  return {
    store,
    connectors: options?.connectors ?? createMockConnectorRegistry(),
    ai: options?.ai ?? new MockAiProvider(),
    logger: silentLogger,
    sleep: async () => {}, // no real backoff waits in tests
  };
}

const INVOICE_INTAKE = {
  name: 'Invoice Intake Demo',
  description: 'demo',
  variables: { approvalThresholdEur: '500' },
  nodes: [
    { id: 'start', kind: 'trigger', name: 'Manual', config: { type: 'manual' } },
    {
      id: 'receive-email',
      kind: 'action',
      name: 'Receive email',
      config: { connector: 'gmail-mock', action: 'fetch_email_with_attachment' },
    },
    {
      id: 'classify',
      kind: 'ai',
      name: 'Classify',
      config: {
        promptTemplate: 'invoice-classify@1',
        input: { document: '{{nodes.receive-email.attachmentText}}' },
      },
    },
    {
      id: 'is-invoice',
      kind: 'condition',
      name: 'Is invoice?',
      config: { expression: '{{nodes.classify.isInvoice}} == true' },
    },
    {
      id: 'notify-not-invoice',
      kind: 'action',
      name: 'Notify not invoice',
      config: {
        connector: 'slack-mock',
        action: 'send_message',
        params: { channel: '#finance', text: 'No es factura' },
      },
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
      name: 'Amount check',
      config: {
        expression: '{{nodes.extract.totalAmount}} < {{variables.approvalThresholdEur}}',
      },
    },
    {
      id: 'approval',
      kind: 'approval',
      name: 'Finance approval',
      config: { title: 'Aprobar factura de {{nodes.extract.vendor}}', requiredRole: 'member' },
    },
    {
      id: 'register',
      kind: 'action',
      name: 'Register',
      config: { connector: 'accounting-mock', action: 'create_entry', params: { from: 'extract' } },
    },
    {
      id: 'notify-registered',
      kind: 'action',
      name: 'Notify registered',
      config: {
        connector: 'slack-mock',
        action: 'send_message',
        params: { channel: '#finance', text: 'Registrada' },
      },
    },
  ],
  edges: [
    { from: 'start', to: 'receive-email' },
    { from: 'receive-email', to: 'classify' },
    { from: 'classify', to: 'is-invoice' },
    { from: 'is-invoice', to: 'extract', branch: 'true' },
    { from: 'is-invoice', to: 'notify-not-invoice', branch: 'false' },
    { from: 'extract', to: 'amount-check' },
    { from: 'amount-check', to: 'register', branch: 'true' },
    { from: 'amount-check', to: 'approval', branch: 'false' },
    { from: 'approval', to: 'register', branch: 'approved' },
    { from: 'approval', to: 'notify-registered', branch: 'rejected' },
    { from: 'register', to: 'notify-registered' },
  ],
};

function invoiceAi(totalAmount: number, isInvoice = true): MockAiProvider {
  return new MockAiProvider({
    'invoice-classify@1': { isInvoice, confidence: 0.97 },
    'invoice-extract@1': {
      vendor: 'ACME Supplies',
      totalAmount,
      date: '2026-06-28',
      vatAmount: totalAmount * 0.21,
    },
  });
}

test('invoice below threshold auto-registers without approval', async () => {
  const store = new InMemoryExecutionStore();
  store.seedExecution('exec-1', INVOICE_INTAKE);
  await runExecution('exec-1', makeDeps(store, { ai: invoiceAi(342.5) }));

  const execution = store.executions.get('exec-1');
  assert.equal(execution?.status, 'succeeded');
  const steps = store.steps.get('exec-1');
  assert.equal(steps?.get('register')?.status, 'succeeded');
  assert.equal(steps?.get('amount-check')?.branch, 'true');
  assert.equal(store.approvals.size, 0);
  assert.equal(steps?.get('notify-registered')?.status, 'succeeded');
});

test('invoice above threshold pauses for approval and resumes on approve', async () => {
  const store = new InMemoryExecutionStore();
  store.seedExecution('exec-2', INVOICE_INTAKE);
  const deps = makeDeps(store, { ai: invoiceAi(1200) });

  await runExecution('exec-2', deps);
  assert.equal(store.executions.get('exec-2')?.status, 'waiting_approval');
  const approval = store.approvals.get('exec-2:approval');
  assert.ok(approval);
  assert.equal(approval.input.title, 'Aprobar factura de ACME Supplies');

  store.resolveApproval('exec-2', 'approval', 'approved');
  await runExecution('exec-2', deps);
  assert.equal(store.executions.get('exec-2')?.status, 'succeeded');
  assert.equal(store.steps.get('exec-2')?.get('register')?.status, 'succeeded');
});

test('rejected approval takes the rejected branch and skips register', async () => {
  const store = new InMemoryExecutionStore();
  store.seedExecution('exec-3', INVOICE_INTAKE);
  const deps = makeDeps(store, { ai: invoiceAi(900) });

  await runExecution('exec-3', deps);
  store.resolveApproval('exec-3', 'approval', 'rejected');
  await runExecution('exec-3', deps);

  assert.equal(store.executions.get('exec-3')?.status, 'succeeded');
  const steps = store.steps.get('exec-3');
  assert.equal(steps?.get('approval')?.branch, 'rejected');
  assert.equal(steps?.get('register'), undefined);
  assert.equal(steps?.get('notify-registered')?.status, 'succeeded');
});

test('non-invoice document takes the false branch', async () => {
  const store = new InMemoryExecutionStore();
  store.seedExecution('exec-4', INVOICE_INTAKE);
  await runExecution('exec-4', makeDeps(store, { ai: invoiceAi(0, false) }));

  assert.equal(store.executions.get('exec-4')?.status, 'succeeded');
  const steps = store.steps.get('exec-4');
  assert.equal(steps?.get('is-invoice')?.branch, 'false');
  assert.equal(steps?.get('notify-not-invoice')?.status, 'succeeded');
  assert.equal(steps?.get('extract'), undefined);
});

test('retryable connector failures retry up to the limit then fail the execution', async () => {
  let attempts = 0;
  const flaky: Connector = {
    slug: 'flaky',
    displayName: 'Flaky',
    auth: 'none',
    actions: [],
    async execute() {
      attempts += 1;
      return {
        ok: false,
        error: { code: 'CONNECTOR_ERROR', message: 'transient boom' },
        retryable: true,
      };
    },
  };
  const definition = {
    name: 'Flaky flow',
    description: '',
    nodes: [
      { id: 'start', kind: 'trigger', name: 'Manual', config: {} },
      { id: 'call', kind: 'action', name: 'Call', config: { connector: 'flaky', action: 'x' } },
    ],
    edges: [{ from: 'start', to: 'call' }],
  };
  const store = new InMemoryExecutionStore();
  store.seedExecution('exec-5', definition);
  const registry = createMockConnectorRegistry();
  registry.set('flaky', flaky);
  await runExecution('exec-5', makeDeps(store, { connectors: registry }));

  assert.equal(attempts, 3); // default max attempts
  const execution = store.executions.get('exec-5');
  assert.equal(execution?.status, 'failed');
  assert.equal(execution?.error?.code, 'CONNECTOR_ERROR');
});

test('recovering connector succeeds on a retry attempt', async () => {
  let attempts = 0;
  const recovering: Connector = {
    slug: 'recovering',
    displayName: 'Recovering',
    auth: 'none',
    actions: [],
    async execute() {
      attempts += 1;
      if (attempts < 2) {
        return { ok: false, error: { code: 'CONNECTOR_ERROR', message: 'blip' }, retryable: true };
      }
      return { ok: true, output: { attempts } };
    },
  };
  const definition = {
    name: 'Recovering flow',
    description: '',
    nodes: [
      { id: 'start', kind: 'trigger', name: 'Manual', config: {} },
      {
        id: 'call',
        kind: 'action',
        name: 'Call',
        config: { connector: 'recovering', action: 'x' },
      },
    ],
    edges: [{ from: 'start', to: 'call' }],
  };
  const store = new InMemoryExecutionStore();
  store.seedExecution('exec-6', definition);
  const registry = createMockConnectorRegistry();
  registry.set('recovering', recovering);
  await runExecution('exec-6', makeDeps(store, { connectors: registry }));

  assert.equal(store.executions.get('exec-6')?.status, 'succeeded');
  assert.equal(attempts, 2);
});

test('wait node pauses and resumes after the recorded time', async () => {
  const definition = {
    name: 'Wait flow',
    description: '',
    nodes: [
      { id: 'start', kind: 'trigger', name: 'Manual', config: {} },
      { id: 'pause', kind: 'wait', name: 'Pause', config: { durationSeconds: 60 } },
      { id: 'after', kind: 'transform', name: 'After', config: { assign: { done: 'yes' } } },
    ],
    edges: [
      { from: 'start', to: 'pause' },
      { from: 'pause', to: 'after' },
    ],
  };
  const store = new InMemoryExecutionStore();
  store.seedExecution('exec-7', definition);
  let scheduledAt: Date | null = null;
  let fakeNow = new Date('2026-07-04T10:00:00Z');
  const deps: ExecutorDeps = {
    ...makeDeps(store),
    scheduleResume: async (_id, resumeAt) => {
      scheduledAt = resumeAt;
    },
    now: () => fakeNow,
  };

  await runExecution('exec-7', deps);
  assert.equal(store.executions.get('exec-7')?.status, 'waiting');
  assert.ok(scheduledAt);

  // Time passes; the resume job fires.
  fakeNow = new Date('2026-07-04T10:02:00Z');
  await runExecution('exec-7', deps);
  assert.equal(store.executions.get('exec-7')?.status, 'succeeded');
  assert.deepEqual(store.steps.get('exec-7')?.get('after')?.output, { done: 'yes' });
});

test('installation config variables override definition defaults', async () => {
  const store = new InMemoryExecutionStore();
  store.seedExecution('exec-8', INVOICE_INTAKE, {
    configVariables: { approvalThresholdEur: '2000' },
  });
  // 1200 < 2000 → auto path despite being above the definition default of 500.
  await runExecution('exec-8', makeDeps(store, { ai: invoiceAi(1200) }));
  assert.equal(store.executions.get('exec-8')?.status, 'succeeded');
  assert.equal(store.approvals.size, 0);
});
