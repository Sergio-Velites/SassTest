import { MockAiProvider } from '@flowhub/ai-gateway';
import { loadEnv } from '@flowhub/config';
import { createMockConnectorRegistry } from '@flowhub/connectors';
import { createDb, schema } from '@flowhub/database';
import { BullMqJobQueue, type JobPayload } from '@flowhub/jobs';
import { createLogger } from '@flowhub/observability';
import { runExecution, type ExecutorDeps } from '@flowhub/workflow-engine';
import { and, eq } from 'drizzle-orm';

import { DrizzleExecutionStore } from './store.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, { app: 'worker' });

if (!env.REDIS_URL || !env.DATABASE_URL) {
  logger.error('REDIS_URL and DATABASE_URL are required to start the worker (see .env.example)');
  process.exit(1);
}

const dbHandle = createDb(env.DATABASE_URL);
const queue = new BullMqJobQueue(env.REDIS_URL);
const store = new DrizzleExecutionStore(dbHandle.db);

/**
 * Canned outputs for the demo prompts while AI_PROVIDER=mock.
 * Cycle 8 replaces this with the full AI Gateway (real providers optional).
 */
const ai = new MockAiProvider({
  'invoice-classify@1': { isInvoice: true, confidence: 0.97 },
  'invoice-extract@1': {
    vendor: 'ACME Supplies S.L.',
    totalAmount: 342.5,
    date: '2026-06-28',
    vatAmount: 59.44,
  },
});

const executorDeps: ExecutorDeps = {
  store,
  connectors: createMockConnectorRegistry(),
  ai,
  logger,
  scheduleResume: async (executionId, resumeAt) => {
    const [execution] = await dbHandle.db
      .select({ organizationId: schema.workflowExecutions.organizationId })
      .from(schema.workflowExecutions)
      .where(eq(schema.workflowExecutions.id, executionId));
    if (!execution) return;
    await queue.schedule(
      'execution.resume-wait',
      { organizationId: execution.organizationId, executionId },
      resumeAt,
    );
  },
};

/**
 * Tenant re-validation (SECURITY_MODEL.md §4): never trust the job payload —
 * reload the execution and compare its organization with the payload's.
 */
async function verifiedRun(payload: JobPayload): Promise<void> {
  const [execution] = await dbHandle.db
    .select({ organizationId: schema.workflowExecutions.organizationId })
    .from(schema.workflowExecutions)
    .where(eq(schema.workflowExecutions.id, payload.executionId));
  if (!execution) {
    logger.warn('job references unknown execution, skipping', {
      executionId: payload.executionId,
    });
    return;
  }
  if (execution.organizationId !== payload.organizationId) {
    logger.error('job payload organization mismatch — refusing to run', {
      executionId: payload.executionId,
    });
    return;
  }
  await runExecution(payload.executionId, executorDeps);
}

queue.process('execution.run', verifiedRun);
queue.process('execution.resume-wait', verifiedRun);
queue.process('approval.expire', async (payload) => {
  if (!payload.approvalRequestId) return;
  // Expire only if still pending, then let the engine take the expired branch.
  await dbHandle.db
    .update(schema.approvalRequests)
    .set({ status: 'expired' })
    .where(
      and(
        eq(schema.approvalRequests.id, payload.approvalRequestId),
        eq(schema.approvalRequests.organizationId, payload.organizationId),
        eq(schema.approvalRequests.status, 'pending'),
      ),
    );
  await verifiedRun(payload);
});

try {
  await queue.ready();
  logger.info('worker ready', { redis: 'connected', handlers: 3 });
} catch (error) {
  logger.error('worker failed to connect to redis', { error: (error as Error).message });
  process.exit(1);
}

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    void queue
      .close()
      .then(() => dbHandle.close())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
