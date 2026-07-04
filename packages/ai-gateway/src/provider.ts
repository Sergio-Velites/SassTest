import type { z } from 'zod';

export type AiProviderName = 'mock' | 'openai' | 'anthropic' | 'gemini';

export interface AiCallRequest {
  /** Versioned prompt template id, e.g. 'invoice-classify@1'. */
  promptTemplateId: string;
  /** Variables interpolated into the template. */
  variables: Record<string, string>;
  /** When set, the provider must return JSON matching this schema. */
  outputSchema?: z.ZodTypeAny;
  /** Soft cap; providers must not exceed it. */
  maxOutputTokens?: number;
}

export interface AiCallTrace {
  provider: AiProviderName;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface AiCallResponse<T = unknown> {
  /** Parsed structured output when outputSchema was provided, raw text otherwise. */
  output: T;
  trace: AiCallTrace;
}

/**
 * Contract every AI provider implements. Providers only handle transport +
 * model invocation; prompt rendering, tracing persistence and guardrails
 * live in the gateway itself (Cycle 8).
 */
export interface AiProvider {
  readonly name: AiProviderName;
  call<T = unknown>(request: AiCallRequest, renderedPrompt: string): Promise<AiCallResponse<T>>;
}
