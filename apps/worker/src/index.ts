import { loadEnv } from '@flowhub/config';
import { BullMqJobQueue } from '@flowhub/jobs';
import { createLogger } from '@flowhub/observability';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, { app: 'worker' });

if (!env.REDIS_URL) {
  logger.error('REDIS_URL is required to start the worker (see .env.example)');
  process.exit(1);
}

const queue = new BullMqJobQueue(env.REDIS_URL);

try {
  await queue.ready();
  // Job handlers (execution.run, execution.resume-wait, approval.expire)
  // are registered here when the engine executor lands in Cycle 6.
  logger.info('worker ready', { redis: 'connected', handlers: 0 });
} catch (error) {
  logger.error('worker failed to connect to redis', { message: (error as Error).message });
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
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
