import { loadEnv } from '@flowhub/config';
import { createDb } from '@flowhub/database';
import { BullMqJobQueue, InMemoryJobQueue } from '@flowhub/jobs';
import { createLogger } from '@flowhub/observability';

import { buildApp } from './app.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, { app: 'api' });

if (!env.DATABASE_URL) {
  logger.error('DATABASE_URL is required to start the API (see .env.example)');
  process.exit(1);
}

const dbHandle = createDb(env.DATABASE_URL);
let queue;
if (env.REDIS_URL) {
  queue = new BullMqJobQueue(env.REDIS_URL);
} else {
  // Executions enqueue into memory and are lost on restart — fine for a dev
  // API without the worker, never acceptable in production.
  queue = new InMemoryJobQueue();
  logger.warn('REDIS_URL not set — using in-memory job queue (jobs are not durable)');
}
const app = await buildApp({ env, logger, db: dbHandle.db, queue });

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info('api listening', { host: env.API_HOST, port: env.API_PORT, docs: '/docs' });
} catch (error) {
  logger.error('api failed to start', { error: (error as Error).message });
  process.exit(1);
}

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    void app
      .close()
      .then(() => queue.close())
      .then(() => dbHandle.close())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
