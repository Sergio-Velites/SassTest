import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryJobQueue } from './memory-queue.js';
import type { JobPayload } from './queue.js';

const payload: JobPayload = {
  organizationId: '4fa2c8a2-9d1b-4f6e-8b6a-2f0d3c4e5a6b',
  executionId: '5fb3d9b3-0e2c-4a7f-9c7b-3a1e4d5f6b7c',
};

test('enqueue dispatches to the registered handler', async () => {
  const queue = new InMemoryJobQueue();
  const seen: JobPayload[] = [];
  queue.process('execution.run', async (p) => {
    seen.push(p);
  });
  await queue.enqueue('execution.run', payload);
  await queue.drain();
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.executionId, payload.executionId);
  await queue.close();
});

test('idempotencyKey deduplicates enqueues', async () => {
  const queue = new InMemoryJobQueue();
  let runs = 0;
  queue.process('execution.run', async () => {
    runs += 1;
  });
  await queue.enqueue('execution.run', payload, { idempotencyKey: 'exec-1' });
  await queue.enqueue('execution.run', payload, { idempotencyKey: 'exec-1' });
  await queue.drain();
  assert.equal(runs, 1);
  await queue.close();
});

test('invalid payload is rejected before enqueueing', async () => {
  const queue = new InMemoryJobQueue();
  await assert.rejects(
    () =>
      queue.enqueue('execution.run', {
        organizationId: 'not-a-uuid',
        executionId: 'nope',
      } as JobPayload),
    /uuid/i,
  );
  await queue.close();
});

test('handler failures are captured, not thrown into the void', async () => {
  const queue = new InMemoryJobQueue();
  queue.process('approval.expire', async () => {
    throw new Error('boom');
  });
  await queue.enqueue('approval.expire', payload);
  await queue.drain();
  assert.equal(queue.failures.length, 1);
  assert.equal(queue.failures[0]?.type, 'approval.expire');
  await queue.close();
});

test('duplicate handler registration is rejected', async () => {
  const queue = new InMemoryJobQueue();
  queue.process('execution.run', async () => {});
  assert.throws(() => queue.process('execution.run', async () => {}), /already registered/);
  await queue.close();
});

test('close cancels pending delayed jobs', async () => {
  const queue = new InMemoryJobQueue();
  let runs = 0;
  queue.process('execution.resume-wait', async () => {
    runs += 1;
  });
  await queue.enqueue('execution.resume-wait', payload, { delayMs: 50 });
  await queue.close();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(runs, 0);
});
