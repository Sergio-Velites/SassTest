/**
 * @flowhub/workflow-engine — core workflow types and definition validation.
 *
 * The engine design is documented in docs/architecture/WORKFLOW_ENGINE.md.
 * Cycle 6 implements the executor; this cycle ships the type contract so the
 * API, worker and frontend can all agree on the workflow JSON shape.
 */

export * from './definition.js';
export * from './execution.js';
