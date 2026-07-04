import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isAppError } from '@flowhub/shared';

import { AiGateway, FixedBudget, InMemoryAiCallSink, InMemoryPromptSource } from './gateway.js';
import { MockAiProvider } from './mock-provider.js';
import type { AiCallRequest, AiCallResponse, AiProvider } from './provider.js';

const TEMPLATES = new InMemoryPromptSource({
  'invoice-classify@1': {
    template: 'Is this an invoice?\n\n{{document}}',
    outputSchema: {
      type: 'object',
      properties: { isInvoice: { type: 'boolean' }, confidence: { type: 'number' } },
      required: ['isInvoice', 'confidence'],
    },
  },
});

function makeGateway(overrides?: {
  provider?: AiProvider;
  spentUsd?: number;
  capUsd?: number;
  timeoutMs?: number;
}) {
  const sink = new InMemoryAiCallSink();
  const gateway = new AiGateway({
    provider:
      overrides?.provider ??
      new MockAiProvider({ 'invoice-classify@1': { isInvoice: true, confidence: 0.9 } }),
    templates: TEMPLATES,
    sink,
    budget: new FixedBudget(overrides?.spentUsd ?? 0),
    monthlyCostCapUsd: overrides?.capUsd ?? 50,
    ...(overrides?.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {}),
  });
  return { gateway, sink };
}

const CALL = {
  organizationId: 'org-1',
  promptTemplateId: 'invoice-classify@1',
  variables: { document: 'INVOICE #42 total 100 EUR' },
};

test('successful call validates output and records a succeeded trace', async () => {
  const { gateway, sink } = makeGateway();
  const result = await gateway.call(CALL);
  assert.deepEqual(result.output, { isInvoice: true, confidence: 0.9 });
  assert.equal(sink.calls.length, 1);
  assert.equal(sink.calls[0]?.status, 'succeeded');
  assert.equal(sink.calls[0]?.organizationId, 'org-1');
});

test('schema mismatch is recorded and surfaces a typed error', async () => {
  const { gateway, sink } = makeGateway({
    provider: new MockAiProvider({ 'invoice-classify@1': { isInvoice: 'yes' } }),
  });
  await assert.rejects(
    () => gateway.call(CALL),
    (e: unknown) => isAppError(e) && e.code === 'AI_PROVIDER_ERROR' && /schema/.test(e.message),
  );
  assert.equal(sink.calls[0]?.status, 'schema_mismatch');
});

test('budget cap blocks calls before touching the provider', async () => {
  const { gateway, sink } = makeGateway({ spentUsd: 60, capUsd: 50 });
  await assert.rejects(
    () => gateway.call(CALL),
    (e: unknown) => isAppError(e) && e.code === 'RATE_LIMITED',
  );
  assert.equal(sink.calls.length, 0); // never reached the provider
});

test('unknown template id fails with VALIDATION_ERROR', async () => {
  const { gateway } = makeGateway();
  await assert.rejects(
    () => gateway.call({ ...CALL, promptTemplateId: 'ghost@9' }),
    (e: unknown) => isAppError(e) && e.code === 'VALIDATION_ERROR',
  );
});

test('slow providers are timed out and the failure is traced', async () => {
  const slow: AiProvider = {
    name: 'mock',
    call<T>(_req: AiCallRequest, _prompt: string): Promise<AiCallResponse<T>> {
      return new Promise(() => {}); // never resolves
    },
  };
  const { gateway, sink } = makeGateway({ provider: slow, timeoutMs: 50 });
  await assert.rejects(
    () => gateway.call(CALL),
    (e: unknown) => isAppError(e) && /timed out/.test(e.message),
  );
  assert.equal(sink.calls[0]?.status, 'failed');
});

test('oversized variables are truncated before rendering', async () => {
  let seenPrompt = '';
  const probe: AiProvider = {
    name: 'mock',
    async call<T>(_req: AiCallRequest, prompt: string): Promise<AiCallResponse<T>> {
      seenPrompt = prompt;
      return {
        output: { isInvoice: true, confidence: 1 } as T,
        trace: {
          provider: 'mock',
          model: 'probe',
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
        },
      };
    },
  };
  const sink = new InMemoryAiCallSink();
  const gateway = new AiGateway({
    provider: probe,
    templates: TEMPLATES,
    sink,
    budget: new FixedBudget(0),
    monthlyCostCapUsd: 50,
    maxVariableChars: 100,
  });
  await gateway.call({ ...CALL, variables: { document: 'x'.repeat(5000) } });
  assert.ok(seenPrompt.includes('[truncated]'));
  assert.ok(seenPrompt.length < 400);
});
