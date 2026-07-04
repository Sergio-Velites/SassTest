import { Queue, Worker } from 'bullmq';

import {
  type EnqueueOptions,
  type JobHandler,
  type JobPayload,
  jobPayloadSchema,
  type JobQueue,
  type JobType,
} from './queue.js';

interface RedisConnection {
  host: string;
  port: number;
  password?: string;
}

function parseRedisUrl(redisUrl: string): RedisConnection {
  const url = new URL(redisUrl);
  const connection: RedisConnection = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
  };
  if (url.password) connection.password = url.password;
  return connection;
}

/**
 * BullMQ-backed JobQueue. One BullMQ queue per job type. Deliberately uses
 * only the portable subset of BullMQ (add with delay + jobId dedup + worker),
 * so a Cloud Tasks implementation can replace it 1:1 (ADR-0005).
 */
export class BullMqJobQueue implements JobQueue {
  private readonly connection: RedisConnection;
  private readonly queues = new Map<JobType, Queue>();
  private readonly workers: Worker[] = [];
  private readonly handledTypes = new Set<JobType>();

  constructor(redisUrl: string) {
    this.connection = parseRedisUrl(redisUrl);
  }

  private queueFor(type: JobType): Queue {
    let queue = this.queues.get(type);
    if (!queue) {
      queue = new Queue(type, { connection: this.connection });
      this.queues.set(type, queue);
    }
    return queue;
  }

  async enqueue(type: JobType, payload: JobPayload, opts?: EnqueueOptions): Promise<string> {
    jobPayloadSchema.parse(payload);
    const job = await this.queueFor(type).add(type, payload, {
      ...(opts?.delayMs !== undefined ? { delay: opts.delayMs } : {}),
      ...(opts?.idempotencyKey !== undefined ? { jobId: opts.idempotencyKey } : {}),
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
    return job.id ?? 'unknown';
  }

  async schedule(type: JobType, payload: JobPayload, runAt: Date): Promise<string> {
    return this.enqueue(type, payload, { delayMs: Math.max(0, runAt.getTime() - Date.now()) });
  }

  process(type: JobType, handler: JobHandler): void {
    if (this.handledTypes.has(type)) {
      throw new Error(`Handler already registered for job type: ${type}`);
    }
    this.handledTypes.add(type);
    this.workers.push(
      new Worker(
        type,
        async (job) => {
          const payload = jobPayloadSchema.parse(job.data);
          await handler(payload);
        },
        { connection: this.connection },
      ),
    );
  }

  async ready(): Promise<void> {
    // Force a real round-trip so startup fails fast on a bad REDIS_URL.
    const probe = this.queueFor('execution.run');
    await probe.waitUntilReady();
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }
}
