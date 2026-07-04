import { z } from 'zod';

/**
 * Job types of the MVP (see docs/architecture/WORKFLOW_ENGINE.md §8).
 * Adding a type here requires a registered handler in the worker.
 */
export const JOB_TYPES = ['execution.run', 'execution.resume-wait', 'approval.expire'] as const;

export type JobType = (typeof JOB_TYPES)[number];

/**
 * Every job payload carries the tenant. Consumers MUST NOT trust it blindly:
 * they reload the referenced entity from the database and re-assert the
 * organization matches (SECURITY_MODEL.md §4).
 */
export const jobPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  executionId: z.string().uuid(),
  /** Present for approval.expire jobs. */
  approvalRequestId: z.string().uuid().optional(),
});

export type JobPayload = z.infer<typeof jobPayloadSchema>;

export interface EnqueueOptions {
  /** Delay before the job becomes runnable. */
  delayMs?: number;
  /**
   * Deduplication key: enqueueing the same (type, idempotencyKey) twice
   * yields a single job. Used e.g. when an approval resolution races a retry.
   */
  idempotencyKey?: string;
}

export type JobHandler = (payload: JobPayload) => Promise<void>;

export interface JobQueue {
  /** Enqueue a job for immediate (or delayed) processing. Returns a job id. */
  enqueue(type: JobType, payload: JobPayload, opts?: EnqueueOptions): Promise<string>;
  /** Enqueue a job to run at a specific time (wait nodes, approval timeouts). */
  schedule(type: JobType, payload: JobPayload, runAt: Date): Promise<string>;
  /** Register the handler that processes jobs of a type. One handler per type. */
  process(type: JobType, handler: JobHandler): void;
  /** Verify connectivity with the backing store (startup check). */
  ready(): Promise<void>;
  /** Stop consuming and release connections. Safe to call more than once. */
  close(): Promise<void>;
}
