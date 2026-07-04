import {
  type EnqueueOptions,
  type JobHandler,
  type JobPayload,
  jobPayloadSchema,
  type JobQueue,
  type JobType,
} from './queue.js';

/**
 * In-memory JobQueue for tests and ephemeral local runs. Single-process,
 * no persistence — never use it where durability matters.
 */
export class InMemoryJobQueue implements JobQueue {
  private readonly handlers = new Map<JobType, JobHandler>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly seenKeys = new Set<string>();
  private counter = 0;
  private closed = false;

  /** Errors thrown by handlers, exposed for test assertions. */
  readonly failures: Array<{ type: JobType; payload: JobPayload; error: unknown }> = [];

  async enqueue(type: JobType, payload: JobPayload, opts?: EnqueueOptions): Promise<string> {
    jobPayloadSchema.parse(payload);
    if (opts?.idempotencyKey) {
      const key = `${type}:${opts.idempotencyKey}`;
      if (this.seenKeys.has(key)) return `dedup:${key}`;
      this.seenKeys.add(key);
    }
    const id = `mem-${++this.counter}`;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void this.dispatch(type, payload);
    }, opts?.delayMs ?? 0);
    this.timers.add(timer);
    return id;
  }

  async schedule(type: JobType, payload: JobPayload, runAt: Date): Promise<string> {
    return this.enqueue(type, payload, { delayMs: Math.max(0, runAt.getTime() - Date.now()) });
  }

  process(type: JobType, handler: JobHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(`Handler already registered for job type: ${type}`);
    }
    this.handlers.set(type, handler);
  }

  async ready(): Promise<void> {
    // Nothing to connect to.
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  /** Test helper: resolves once queued microtasks/timers at 0ms have run. */
  async drain(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  private async dispatch(type: JobType, payload: JobPayload): Promise<void> {
    if (this.closed) return;
    const handler = this.handlers.get(type);
    if (!handler) {
      this.failures.push({ type, payload, error: new Error(`No handler for ${type}`) });
      return;
    }
    try {
      await handler(payload);
    } catch (error) {
      this.failures.push({ type, payload, error });
    }
  }
}
