/**
 * apps/worker placeholder. Cycle 6 implements the BullMQ consumer that
 * drives workflow executions through @flowhub/workflow-engine. The queue
 * is accessed only through the JobQueue abstraction so the backend can be
 * swapped for Pub/Sub or Cloud Tasks in GCP (see ADR-0005).
 */
export const APP = 'worker';
