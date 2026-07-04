/**
 * @flowhub/jobs — JobQueue abstraction (ADR-0005).
 *
 * Business logic (api, worker, engine) only ever sees the JobQueue interface.
 * Implementations: BullMqJobQueue (Redis, local + first cloud phase) and
 * InMemoryJobQueue (tests and ephemeral local runs). A Cloud Tasks / Pub/Sub
 * implementation can be added later without touching producers or consumers.
 */

export * from './queue.js';
export * from './memory-queue.js';
export * from './bullmq-queue.js';
