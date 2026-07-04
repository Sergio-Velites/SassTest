/**
 * @flowhub/ai-gateway — provider-agnostic AI layer.
 *
 * Design rules (see ADR-0007):
 * - Business logic NEVER imports an AI SDK directly; it calls AiGateway.
 * - Providers are interchangeable via AI_PROVIDER env var: mock | openai | anthropic.
 * - Every call is traced (model, latency, tokens, estimated cost) — traces are
 *   persisted to the ai_calls table by the caller.
 * - Prompts live in versioned templates, never inline in business logic.
 * - Mock mode is mandatory for tests and local development without API keys.
 */

export * from './provider.js';
export * from './mock-provider.js';
