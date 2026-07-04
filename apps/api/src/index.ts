import { loadEnv } from '@flowhub/config';
import { createLogger } from '@flowhub/observability';

import { buildApp } from './app.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, { app: 'api' });

const app = await buildApp({ env, logger });

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info('api listening', { host: env.API_HOST, port: env.API_PORT, docs: '/docs' });
} catch (error) {
  logger.error('api failed to start', { error: (error as Error).message });
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('shutting down', { signal });
    void app.close().then(() => process.exit(0));
  });
}
