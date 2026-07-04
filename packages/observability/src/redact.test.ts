import assert from 'node:assert/strict';
import { test } from 'node:test';

import { redact } from './index.js';

test('redact masks sensitive keys at any depth', () => {
  const result = redact({
    userEmail: 'x@example.com',
    apiKey: 'sk-live-123',
    nested: { authorization: 'Bearer abc', safe: 1 },
  });
  assert.equal(result['apiKey'], '[REDACTED]');
  assert.deepEqual(result['nested'], { authorization: '[REDACTED]', safe: 1 });
  assert.equal(result['userEmail'], 'x@example.com');
});
