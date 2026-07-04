/**
 * @flowhub/shared — domain-wide primitives.
 *
 * Everything here must be dependency-light and usable from web, api and worker.
 * Domain-specific logic belongs in its own package, not here.
 */

export * from './ids.js';
export * from './result.js';
export * from './errors.js';
export * from './tenant.js';
