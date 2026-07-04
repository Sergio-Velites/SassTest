import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';

import { MockAiProvider } from './mock-provider.js';

test('mock provider returns canned response validated against schema', async () => {
  const provider = new MockAiProvider({
    'invoice-classify@1': { isInvoice: true, confidence: 0.97 },
  });
  const schema = z.object({ isInvoice: z.boolean(), confidence: z.number() });
  const response = await provider.call(
    { promptTemplateId: 'invoice-classify@1', variables: {}, outputSchema: schema },
    'Is this document an invoice?',
  );
  assert.deepEqual(response.output, { isInvoice: true, confidence: 0.97 });
  assert.equal(response.trace.provider, 'mock');
  assert.equal(response.trace.estimatedCostUsd, 0);
});

test('mock provider echoes when no canned response exists', async () => {
  const provider = new MockAiProvider();
  const response = await provider.call<{ mock: boolean }>(
    { promptTemplateId: 'unknown@1', variables: {} },
    'hello',
  );
  assert.equal(response.output.mock, true);
});
